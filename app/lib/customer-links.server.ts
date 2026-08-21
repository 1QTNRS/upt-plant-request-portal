import { customerPortalLinks, type CustomerPortalLinks } from "./app-proxy";
import { isDevAdminBypass } from "./shop";

/**
 * Links the portal hands to a customer outside a request (offer emails, stored
 * offer links, the checkout fallback).
 *
 * These have to be absolute storefront URLs: a link to the app's own origin
 * carries no signed `logged_in_customer_id`, so the customer would land on
 * "Request not available". The local demo has no storefront, so it keeps
 * pointing at the app origin.
 */
export function customerLinksForShop(
  shop: string,
  appUrl = process.env.SHOPIFY_APP_URL ?? "",
): CustomerPortalLinks {
  return customerPortalLinks({
    shop,
    appUrl,
    viaAppProxy: !isDevAdminBypass(),
  });
}
