import { offlineAdminClient, type AdminGraphqlClient } from "./offline-admin.server";

/**
 * The storefront hostnames a shop's customers actually browse.
 *
 * A proxied form submission carries the `Origin` of the page it came from, and
 * that page is on the shop's *primary* domain — which is a custom domain for
 * most live stores, while the signed `shop` parameter is always the
 * `.myshopify.com` one. Comparing the origin to `shop` alone would therefore
 * work on a development store and reject every submission on a store with its
 * own domain.
 */
const SHOP_DOMAINS_QUERY = `#graphql
  query PortalShopDomains {
    shop {
      myshopifyDomain
      primaryDomain { host }
      # Deprecated in favour of domainsPaginated, which does not exist on Shop
      # in 2025-10 — the deprecation notice points at a field the version does
      # not have. Revisit when bumping the API version.
      domains { host }
    }
  }
`;

type ShopDomainsResult = {
  shop: {
    myshopifyDomain: string | null;
    primaryDomain: { host: string | null } | null;
    domains: Array<{ host: string | null }> | null;
  } | null;
};

/**
 * Cached because it is read on every proxied submission and a shop's domains
 * change roughly never. A failed lookup is cached for a shorter time so an
 * Admin API outage does not turn into a lookup per request.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const cache = new Map<string, { hosts: string[]; expiresAt: number }>();

/** Escape hatch for a domain the Admin API cannot be asked about yet. */
function configuredHosts(): string[] {
  return (process.env.APP_PROXY_STOREFRONT_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

async function fetchShopDomains(
  admin: AdminGraphqlClient,
): Promise<string[]> {
  const response = await admin.graphql(SHOP_DOMAINS_QUERY);
  const body = (await response.json()) as {
    data?: ShopDomainsResult;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }

  // Every domain, not just the primary one: a shop serving an apex/www split or
  // an international domain would otherwise have submissions from its other
  // hosts refused, and only submissions — a GET carries no Origin, so the portal
  // reads fine and only writes fail, which is a miserable thing to diagnose.
  return [
    body.data?.shop?.myshopifyDomain,
    body.data?.shop?.primaryDomain?.host,
    ...(body.data?.shop?.domains ?? []).map((domain) => domain.host),
  ]
    .map((host) => host?.trim().toLowerCase())
    .filter((host): host is string => Boolean(host));
}

/**
 * Hostnames that may legitimately appear as the `Origin` of a request Shopify
 * proxied for `shop`.
 *
 * The shop's own `.myshopify.com` domain is always allowed without asking
 * Shopify, so the portal keeps working when no offline session exists yet.
 */
export async function storefrontHostsForShop(shop: string): Promise<string[]> {
  const normalized = shop.trim().toLowerCase();
  const always = [normalized, ...configuredHosts()];

  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return [...new Set([...always, ...cached.hosts])];
  }

  let hosts: string[] = [];
  let ttl = FAILURE_TTL_MS;
  const admin = await offlineAdminClient(normalized);
  if (admin) {
    try {
      hosts = await fetchShopDomains(admin);
      ttl = CACHE_TTL_MS;
    } catch (error) {
      console.error(`Could not read the storefront domains for ${shop}.`, error);
    }
  }

  cache.set(normalized, { hosts, expiresAt: Date.now() + ttl });
  return [...new Set([...always, ...hosts])];
}

/** Test seam; the cache is process-wide and otherwise never cleared. */
export function resetStorefrontHostCache(): void {
  cache.clear();
}
