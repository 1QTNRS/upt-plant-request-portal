/**
 * Customer-facing navigation targets. Kept free of Node built-ins so the
 * customer layout can import it into the browser bundle.
 */

/** Internal route Shopify's app proxy forwards to. */
const CUSTOMER_APP_PATH = "/customer";

/** Storefront path of the app proxy. Must match `[app_proxy]` in shopify.app.toml. */
const STOREFRONT_PORTAL_PATH = "/apps/plant-requests";

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
  return viaAppProxy ? STOREFRONT_PORTAL_PATH : CUSTOMER_APP_PATH;
}

/**
 * Relative storefront path Shopify may send the customer back to after login.
 *
 * `return_to` only accepts a path on this shop (`/apps/plant-requests…`).
 * A full URL, `//host`, or anything outside the portal is replaced with the
 * portal home so a crafted value cannot bounce someone off the storefront.
 */
export function storefrontPortalReturnPath(returnPath: string): string {
  const pathOnly = returnPath.split("?")[0]?.split("#")[0] ?? "";
  if (
    !pathOnly.startsWith("/") ||
    pathOnly.startsWith("//") ||
    pathOnly.includes("\\") ||
    pathOnly.includes("://")
  ) {
    return STOREFRONT_PORTAL_PATH;
  }

  const segments = pathOnly.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) return STOREFRONT_PORTAL_PATH;

  const normalized = `/${segments.join("/")}`;
  if (
    normalized === STOREFRONT_PORTAL_PATH ||
    normalized.startsWith(`${STOREFRONT_PORTAL_PATH}/`)
  ) {
    return normalized;
  }
  return STOREFRONT_PORTAL_PATH;
}

/**
 * Shopify customer-account login on the current storefront, then back to this
 * portal page. The href is relative so it stays on the shop domain the
 * customer is already browsing — never the app origin.
 */
export function shopifyCustomerLoginHref(returnPath: string): string {
  const safe = storefrontPortalReturnPath(returnPath);
  return `/customer_authentication/login?return_to=${encodeURIComponent(safe)}`;
}

/**
 * The live storefront already wraps app-proxy pages in the shop theme, so
 * Home / My Requests would sit under UPT's real menu. Keep that chrome only
 * on the local `/customer` demo, which has no theme header.
 */
export function shouldRenderCustomerPortalNav(viaAppProxy: boolean): boolean {
  return !viaAppProxy;
}
