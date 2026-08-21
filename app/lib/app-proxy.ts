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
 * Where `server.js` parks the storefront `Origin` of a proxied form submission.
 *
 * React Router 7.12 rejects an action whose `Origin` header does not match the
 * host in `request.url`. Shopify's app proxy forwards the storefront's `Origin`
 * to the app's own hostname, so every proxied POST looked like a cross-site
 * attack and came back as a bare "Bad Request" before any route ran. `server.js`
 * moves the header aside for proxy requests and this module decides whether the
 * origin was really a storefront of the signed shop — a check the framework
 * cannot make, because only the app can verify Shopify's signature.
 *
 * The header is stripped from every incoming request first, so a client cannot
 * set it itself.
 */
export const APP_PROXY_ORIGIN_HEADER = "x-shopify-app-proxy-origin";

/** Hostname of an `Origin` header, or null when it is absent or unparseable. */
export function originHost(origin: string | null | undefined): string | null {
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a withheld storefront origin belongs to the shop that signed the
 * request.
 *
 * This is what keeps the relaxed origin check safe. Shopify signs whatever it
 * proxies, including a cross-site form post aimed at the storefront, so the
 * signature alone cannot tell a customer's own submission from a forged one —
 * the origin can, because a browser sets it to the page the form came from and
 * `shop` is covered by the signature.
 */
export function storefrontOriginIsAllowed(
  origin: string | null | undefined,
  allowedHosts: readonly string[],
): boolean {
  const host = originHost(origin);
  if (!host) return false;
  return allowedHosts.some((allowed) => allowed.trim().toLowerCase() === host);
}

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
