/**
 * Classifies a pull request as routine (auto-merge eligible) or high-risk
 * (owner approval required). Uncertain diffs are high-risk.
 */

export const HIGH_RISK_LABEL = "high-risk";
export const ROUTINE_LABEL = "routine";
export const NEEDS_APPROVAL_LABEL = "needs-approval";

export const APPROVED_SMOKE_SHOP = "upt-plant-request-dev.myshopify.com";

/** Shops automation must never target. */
export const FORBIDDEN_PRODUCTION_SHOPS = [
  "unsolicited-plant-talks.myshopify.com",
  "unsolicitedplanttalks.myshopify.com",
] as const;

const HIGH_RISK_PATHS: RegExp[] = [
  /^prisma\//,
  /^render\.yaml$/,
  /^Dockerfile$/,
  /^server\.js$/,
  /^shopify\.app\.toml$/,
  /^\.github\/workflows\//,
  /^app\/lib\/env\.server\.ts$/,
  /^app\/lib\/admin-auth/,
  /^app\/lib\/app-proxy/,
  /^app\/lib\/customer-identity/,
  /^app\/lib\/customer-session/,
  /^app\/lib\/production-safety/,
  /^app\/lib\/shopify-ops/,
  /^app\/lib\/draft-order/,
  /^app\/lib\/growers-choice/,
  /^app\/lib\/scheduler/,
  /^app\/lib\/smoke-auth/,
  /^app\/lib\/smoke-cleanup/,
  /^app\/lib\/pr-risk\.ts$/,
  /^app\/routes\/webhooks/,
  /^app\/routes\/events/,
  /^app\/routes\/auth/,
  /^app\/routes\/smoke/,
  /^app\/shopify\.server\.ts$/,
];

const HIGH_RISK_KEYWORDS =
  /\b(payment|draft order|inventory|reservation|migration|webhook|auth|privacy|redact|production store|upt store|destruct)\b/i;

export type PrRisk = "routine" | "high-risk";

export type PrRiskInput = {
  title?: string;
  body?: string;
  labels?: string[];
  files?: string[];
};

export function classifyPullRequestRisk(input: PrRiskInput): {
  risk: PrRisk;
  reasons: string[];
} {
  const labels = new Set((input.labels ?? []).map((label) => label.toLowerCase()));
  if (labels.has(HIGH_RISK_LABEL) || labels.has(NEEDS_APPROVAL_LABEL)) {
    return { risk: "high-risk", reasons: ["PR carries a high-risk / needs-approval label."] };
  }

  const reasons: string[] = [];
  const files = input.files ?? [];
  if (files.length === 0) {
    return {
      risk: "high-risk",
      reasons: ["No changed-file list; uncertain diffs are high-risk."],
    };
  }
  for (const file of files) {
    if (HIGH_RISK_PATHS.some((pattern) => pattern.test(file))) {
      reasons.push(`high-risk path: ${file}`);
    }
  }

  const text = `${input.title ?? ""}\n${input.body ?? ""}`;
  if (HIGH_RISK_KEYWORDS.test(text) && reasons.length === 0) {
    // Keywords alone are a hint; only escalate when no path already did,
    // and only if the title/body is not a docs-only "document the webhook".
    const codeTouched = files.some(
      (file) =>
        file.startsWith("app/") ||
        file.startsWith("prisma/") ||
        file === "render.yaml" ||
        file === "server.js" ||
        file === "Dockerfile",
    );
    if (codeTouched) reasons.push("title or body mentions a high-risk area.");
  }

  if (reasons.length > 0) return { risk: "high-risk", reasons };
  return { risk: "routine", reasons: ["No high-risk paths or labels."] };
}

export function isApprovedSmokeShop(shop: string): boolean {
  return shop === APPROVED_SMOKE_SHOP;
}

export function assertApprovedSmokeShop(shop: string): void {
  if (FORBIDDEN_PRODUCTION_SHOPS.includes(shop as (typeof FORBIDDEN_PRODUCTION_SHOPS)[number])) {
    throw new Error("Smoke automation refused: this is a production shop.");
  }
  if (!isApprovedSmokeShop(shop)) {
    throw new Error(
      `Smoke automation refused: shop must be exactly ${APPROVED_SMOKE_SHOP}.`,
    );
  }
}
