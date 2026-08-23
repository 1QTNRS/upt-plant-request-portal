import { APPROVED_SMOKE_SHOP } from "../../app/lib/pr-risk";
import { signAppProxySearch } from "../../app/lib/app-proxy";
import { signSmokeToken, SMOKE_COOKIE } from "../../app/lib/smoke-auth.server";

export function requireApprovedShop(): string {
  const shop = process.env.SMOKE_SHOP || APPROVED_SMOKE_SHOP;
  if (shop !== APPROVED_SMOKE_SHOP) {
    throw new Error(`Refused shop ${shop}`);
  }
  return shop;
}

export function smokeAdminToken(): string | null {
  return signSmokeToken();
}

export function smokeAdminCookie(): string | null {
  const token = smokeAdminToken();
  if (!token) return null;
  return `${SMOKE_COOKIE}=${encodeURIComponent(token)}`;
}

export function signedCustomerPath(
  path: string,
  customerId: string,
): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;
  const shop = requireApprovedShop();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const search = signAppProxySearch(
    {
      shop,
      logged_in_customer_id: customerId,
      path_prefix: "/apps/plant-requests",
      timestamp,
    },
    secret,
  );
  return `${path}?${search.toString()}`;
}
