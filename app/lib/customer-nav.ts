/**
 * Customer-facing navigation targets. Kept free of Node built-ins so the
 * customer layout can import it into the browser bundle.
 */

/** Internal route Shopify's app proxy forwards to. */
const CUSTOMER_APP_PATH = "/customer";

/**
 * Whether this request is arriving through the storefront app proxy.
 *
 * Used to wrap the page in the shop theme (`application/liquid`) and to skip
 * our own Home / My Requests bar. Does not validate the HMAC — identity still
 * goes through `readCustomerContext`.
 */
export function requestLooksLikeAppProxy(url: string | URL): boolean {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const path = parsed.pathname;
  if (path !== CUSTOMER_APP_PATH && !path.startsWith(`${CUSTOMER_APP_PATH}/`)) {
    return false;
  }
  return Boolean(parsed.searchParams.get("shop") && parsed.searchParams.get("signature"));
}

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
