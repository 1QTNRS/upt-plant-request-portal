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
