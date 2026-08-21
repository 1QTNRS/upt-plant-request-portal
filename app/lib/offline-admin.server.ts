import type { AdminContext } from "./admin-auth.server";
import { isDevAdminBypass } from "./shop";
import { unauthenticated } from "../shopify.server";

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
 */
export async function offlineAdminClient(
  shop: string,
): Promise<AdminGraphqlClient | undefined> {
  if (isDevAdminBypass()) return undefined;

  try {
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
