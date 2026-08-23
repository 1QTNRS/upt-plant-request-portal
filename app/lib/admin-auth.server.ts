import { authenticate } from "../shopify.server";
import { smokeAdminContext } from "./smoke-auth.server";
import { DEMO_SHOP, isDevAdminBypass } from "./shop";

export { DEMO_SHOP, isDevAdminBypass };

export type AdminContext = {
  shop: string;
  /** `scope` is the comma-separated list the merchant actually granted. */
  session?: { shop: string; scope?: string | null };
  admin?: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
};

export async function requireAdmin(request: Request): Promise<AdminContext> {
  if (isDevAdminBypass()) {
    return { shop: process.env.DEV_SHOP || DEMO_SHOP };
  }

  const smoke = smokeAdminContext(request);
  if (smoke) {
    return { shop: smoke.shop };
  }

  const { session, admin } = await authenticate.admin(request);
  return { shop: session.shop, session, admin };
}
