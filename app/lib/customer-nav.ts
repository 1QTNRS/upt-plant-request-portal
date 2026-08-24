/**
 * Customer-facing navigation targets. Kept free of Node built-ins so the
 * customer layout can import it into the browser bundle.
 */

export function storefrontHomeUrl(input: {
  shop?: string | null;
  viaAppProxy: boolean;
}): string {
  if (input.viaAppProxy && input.shop) {
    const host = input.shop.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }
  return "/";
}

export function customerMyRequestsHref(viaAppProxy: boolean): string {
  return viaAppProxy ? "/apps/plant-requests" : "/customer";
}

/**
 * The live storefront already wraps app-proxy pages in the shop theme, so
 * Home / My Requests would sit under UPT's real menu. Keep that chrome only
 * on the local `/customer` demo, which has no theme header.
 */
export function shouldRenderCustomerPortalNav(viaAppProxy: boolean): boolean {
  return !viaAppProxy;
}
