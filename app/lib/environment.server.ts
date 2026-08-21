import { isProduction } from "./env.server";
import { DEMO_SHOP, isDevAdminBypass } from "./shop";

/**
 * Production-mode detection is deliberately independent of `isDevAdminBypass()`
 * so that a stray `SHOPIFY_API_KEY=devkey` can never open the local admin bypass
 * on a deployed instance.
 *
 * Delegates to `env.server.ts` so there is one definition of "in production" —
 * two that could disagree is how demo data reaches a real shop.
 */
export function isProductionRuntime(): boolean {
  return isProduction();
}

/**
 * Demo data (`ensureShopSeeded`, the Alex Rivera customer, placeholder photos,
 * stub Shopify GIDs) may only ever touch a throwaway shop. A real merchant shop
 * must never receive seeded requests.
 */
export function isDemoDataEnabled(shop?: string): boolean {
  if (isProductionRuntime()) return false;
  if (process.env.UPT_DEMO_DATA === "false") return false;
  if (!shop) return isDevAdminBypass();
  return shop === (process.env.DEV_SHOP || DEMO_SHOP) || shop.startsWith(DEMO_SHOP);
}

/**
 * Shopify-side writes must never be faked against a real shop. When there is no
 * Admin API client we either stub (demo shop) or fail loudly (everything else).
 */
export function canStubShopifyWrites(shop: string): boolean {
  return isDemoDataEnabled(shop);
}

export class MissingAdminSessionError extends Error {
  constructor(operation: string) {
    super(
      `${operation} requires an authenticated Shopify Admin API session. Install the app on the shop and re-approve the requested access scopes.`,
    );
    this.name = "MissingAdminSessionError";
  }
}

export function requireAdminClient<T>(
  admin: T | undefined,
  shop: string,
  operation: string,
): T | undefined {
  if (admin) return admin;
  if (canStubShopifyWrites(shop)) return undefined;
  throw new MissingAdminSessionError(operation);
}

export type MissingSecret = {
  name: string;
  reason: string;
};

/**
 * Surfaced in the admin Settings page so the merchant can see exactly which
 * credentials are still missing rather than discovering it at checkout time.
 */
export function missingProductionSecrets(): MissingSecret[] {
  const missing: MissingSecret[] = [];

  if (!process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_API_KEY === "devkey") {
    missing.push({
      name: "SHOPIFY_API_KEY",
      reason: "Required for embedded admin OAuth and App Bridge.",
    });
  }
  if (!process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET === "devsecret") {
    missing.push({
      name: "SHOPIFY_API_SECRET",
      reason:
        "Required to verify App Proxy signatures and webhook HMACs. Customers cannot sign in without it.",
    });
  }
  if (!process.env.SHOPIFY_APP_URL) {
    missing.push({
      name: "SHOPIFY_APP_URL",
      reason: "Required for OAuth callbacks and links in customer emails.",
    });
  }
  if (!process.env.RESEND_API_KEY) {
    missing.push({
      name: "RESEND_API_KEY",
      reason: "Without it, emails stay in the outbox with status \"preview\" and are never delivered.",
    });
  }
  if (!process.env.CRON_SECRET) {
    missing.push({
      name: "CRON_SECRET",
      reason:
        "Required to authorize POST /cron/offer-maintenance, which expires offers and sends reminder emails.",
    });
  }

  return missing;
}
