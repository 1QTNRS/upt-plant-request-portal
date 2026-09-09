/**
 * One-time production test-data cleanup for a single customer email.
 *
 * Default mode is dry-run. Destructive cleanup requires an explicit
 * confirmation token and must never be wired into app startup or cron.
 *
 * Examples:
 *   DATABASE_URL='postgresql://…' npx tsx scripts/cleanup-test-customer.mts \
 *     --email=aprilbalaga@yahoo.com --dry-run
 *
 *   DATABASE_URL='postgresql://…' SHOPIFY_APP_URL='https://…' \
 *     npx tsx scripts/cleanup-test-customer.mts \
 *     --email=aprilbalaga@yahoo.com \
 *     --confirm=DELETE-TEST-DATA \
 *     --void-shopify-drafts
 */
import process from "node:process";

import {
  DEFAULT_PRODUCTION_SHOP,
  TEST_CUSTOMER_CLEANUP_CONFIRM,
  auditTestCustomerCleanup,
  deleteTestCustomerCleanup,
  isValidCleanupConfirmation,
  normalizeCleanupEmail,
  verifyTestCustomerCleanup,
} from "../app/lib/test-customer-cleanup.server";
import { offlineAdminClient } from "../app/lib/offline-admin.server";

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/cleanup-test-customer.mts --email=<address> [--shop=<shop>] [--dry-run]
  npx tsx scripts/cleanup-test-customer.mts --email=<address> --confirm=${TEST_CUSTOMER_CLEANUP_CONFIRM} [--void-shopify-drafts]

Options:
  --email=<address>     Required. Exact customer email (case-insensitive).
  --shop=<domain>       Shopify shop domain (default: ${DEFAULT_PRODUCTION_SHOP}).
  --dry-run             Audit only (default when --confirm is omitted).
  --confirm=<token>     Required for deletion. Must be ${TEST_CUSTOMER_CLEANUP_CONFIRM}.
  --void-shopify-drafts With --confirm, delete live unpaid Shopify draft orders first.
  --help                Show this message.
`);
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg === `--${name}`) return "";
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

const emailArg = readArg("email");
if (hasFlag("help") || !emailArg) usage();

const email = normalizeCleanupEmail(emailArg);
if (!email.includes("@")) {
  console.error("Invalid --email value.");
  process.exit(1);
}

const shop = readArg("shop")?.trim() || DEFAULT_PRODUCTION_SHOP;
const confirm = readArg("confirm");
const dryRun = !confirm;
const voidShopifyDrafts = hasFlag("void-shopify-drafts");

if (!dryRun && !isValidCleanupConfirmation(confirm)) {
  console.error(
    `Refusing destructive cleanup without --confirm=${TEST_CUSTOMER_CLEANUP_CONFIRM}.`,
  );
  process.exit(1);
}

if (voidShopifyDrafts && dryRun) {
  console.error("--void-shopify-drafts requires --confirm.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const admin =
  process.env.SHOPIFY_APP_URL && (dryRun || voidShopifyDrafts)
    ? await offlineAdminClient(shop)
    : undefined;

if ((dryRun || voidShopifyDrafts) && process.env.SHOPIFY_APP_URL && !admin) {
  console.warn(
    `Warning: could not load offline Shopify Admin session for ${shop}. ` +
      "Portal audit will still run; live Shopify lookups will be skipped.",
  );
}

console.log(
  dryRun
    ? `DRY RUN — no portal data will be deleted for ${email} on ${shop}.`
    : `DESTRUCTIVE RUN — deleting portal data for ${email} on ${shop}.`,
);

const audit = await auditTestCustomerCleanup(shop, email, admin ?? undefined);
console.log(JSON.stringify(audit, null, 2));

if (audit.counts.requests === 0) {
  console.log("Nothing to delete. Exiting.");
  process.exit(0);
}

if (dryRun) {
  console.log(
    "\nDry run complete. To delete portal data after review, run:\n\n" +
      `DATABASE_URL='…' SHOPIFY_APP_URL='…' npx tsx scripts/cleanup-test-customer.mts \\\n` +
      `  --email=${email} \\\n` +
      `  --shop=${shop} \\\n` +
      `  --confirm=${TEST_CUSTOMER_CLEANUP_CONFIRM}` +
      (audit.shopify.draftOrdersEligibleForVoid > 0
        ? " \\\n  --void-shopify-drafts"
        : "") +
      "\n",
  );
  if (audit.shopify.completedOrdersRequireManualReview > 0) {
    console.log(
      "Completed Shopify orders were found and will NOT be deleted automatically. Review shopify.completedOrders above.",
    );
  }
  if (audit.shopify.exactPlantProductsRequireManualReview > 0) {
    console.log(
      "Exact Plant Shopify products were found and will NOT be deleted automatically. Review shopify.exactPlantProducts above.",
    );
  }
  process.exit(0);
}

if (audit.shopify.completedOrdersRequireManualReview > 0) {
  console.warn(
    `Warning: ${audit.shopify.completedOrdersRequireManualReview} completed Shopify order(s) exist. ` +
      "Portal rows will be removed; Shopify orders are untouched.",
  );
}

const result = await deleteTestCustomerCleanup(shop, email, {
  voidShopifyDrafts,
  admin: admin ?? undefined,
});

console.log(JSON.stringify({ deleted: result }, null, 2));

const verification = await verifyTestCustomerCleanup(
  shop,
  email,
  audit.analyticsImpact.requestNumbersRemoved,
);
console.log(JSON.stringify({ verification }, null, 2));
console.log("Cleanup complete.");
