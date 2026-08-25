import type { AdminContext } from "./admin-auth.server";
import { isDevAdminBypass } from "./shop";

export type AdminGraphqlClient = NonNullable<AdminContext["admin"]>;

/**
 * Admin API client for a shop outside a merchant-authenticated request.
 *
 * The customer portal is served through the app proxy, so it has no admin
 * session of its own, but it still has to create draft orders and read customer
 * records. That requires the stored offline access token for the shop.
 *
 * Returns undefined when no offline session exists (the app is not installed,
 * or the local dev bypass is active) so callers can fall back to demo
 * behaviour instead of failing the request.
 *
 * `shopify.server` is loaded only when a real Admin client can exist. Importing
 * it at module load boots `shopifyApp`, which throws on an empty `appUrl` —
 * that is how unit tests that never talk to Shopify were failing in CI.
 */
export async function offlineAdminClient(
  shop: string,
): Promise<AdminGraphqlClient | undefined> {
  if (isDevAdminBypass()) return undefined;
  if (!process.env.SHOPIFY_APP_URL) return undefined;

  try {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  } catch (error) {
    console.error(
      `No offline Shopify Admin session for ${shop}; Shopify writes will be skipped.`,
      error,
    );
    return undefined;
  }
}
