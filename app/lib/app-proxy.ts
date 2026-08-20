import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * App proxy configuration. Must match the `[app_proxy]` block in
 * shopify.app.toml — `app/lib/app-proxy.test.ts` asserts that.
 */
export const APP_PROXY_PREFIX = "apps";
export const APP_PROXY_SUBPATH = "plant-requests";
export const APP_PROXY_BASE_PATH = `/${APP_PROXY_PREFIX}/${APP_PROXY_SUBPATH}`;

/** Route the app proxy forwards to, i.e. `url` in the `[app_proxy]` block. */
export const CUSTOMER_PORTAL_PATH = "/customer";

/**
 * Recomputes the app proxy signature.
 *
 * Shopify signs proxied requests by sorting the query parameters, joining
 * repeated values with a comma, concatenating `key=value` pairs with no
 * separator, and taking the hex HMAC-SHA256 under the app's client secret.
 * Without this check anyone could impersonate a customer by appending
 * `?logged_in_customer_id=…`.
 */
export function appProxySignatureIsValid(
  search: URLSearchParams,
  apiSecret: string,
): boolean {
  const signature = search.get("signature");
  if (!signature || !apiSecret) return false;

  const grouped = new Map<string, string[]>();
  for (const [key, value] of search) {
    if (key === "signature") continue;
    const values = grouped.get(key);
    if (values) values.push(value);
    else grouped.set(key, [value]);
  }

  const message = [...grouped.keys()]
    .sort()
    .map((key) => `${key}=${grouped.get(key)!.join(",")}`)
    .join("");

  const expected = createHmac("sha256", apiSecret)
    .update(message, "utf8")
    .digest("hex");

  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(signature, "utf8");
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

export type CustomerPortalLinks = {
  /** "My Requests" list. */
  home: string;
  requestDetail: (requestId: string) => string;
};

/**
 * Customer-facing links must resolve on the storefront, not on the app's own
 * origin: only requests that arrive through the app proxy carry a signed
 * `logged_in_customer_id`, so an app-origin link shows "Request not available".
 * The local demo has no storefront, so it keeps using the app origin.
 */
export function customerPortalLinks(input: {
  shop?: string | null;
  appUrl?: string | null;
  viaAppProxy: boolean;
}): CustomerPortalLinks {
  if (input.viaAppProxy && input.shop) {
    const origin = `https://${input.shop.replace(/\/+$/, "")}`;
    return {
      home: `${origin}${APP_PROXY_BASE_PATH}`,
      requestDetail: (requestId) =>
        `${origin}${APP_PROXY_BASE_PATH}/requests/${requestId}`,
    };
  }

  const origin = (input.appUrl ?? "").replace(/\/+$/, "");
  return {
    home: `${origin}${CUSTOMER_PORTAL_PATH}`,
    requestDetail: (requestId) =>
      `${origin}${CUSTOMER_PORTAL_PATH}/requests/${requestId}`,
  };
}

/**
 * Relative links for the page the customer is currently on. Under the proxy the
 * storefront path is the proxy path, so a link to `/customer/...` would leave
 * the storefront and lose the signed identity.
 */
export function customerPortalRelativeLinks(viaAppProxy: boolean): CustomerPortalLinks {
  const base = viaAppProxy ? APP_PROXY_BASE_PATH : CUSTOMER_PORTAL_PATH;
  return {
    home: base,
    requestDetail: (requestId) => `${base}/requests/${requestId}`,
  };
}
