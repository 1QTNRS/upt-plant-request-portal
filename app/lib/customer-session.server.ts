import { createCookie } from "react-router";

import { appProxySignatureIsValid } from "./app-proxy";
import { isProduction } from "./env.server";
import { DEMO_SHOP, isDevAdminBypass } from "./shop";

export type CustomerIdentity = {
  email: string;
  name: string;
  shopifyCustomerId?: string;
};

export type CustomerSession = CustomerIdentity & {
  shop: string;
};

/**
 * What the portal knows about the current visitor. `shop` is resolved even when
 * nobody is signed in, so the portal can still render the request form.
 */
export type CustomerContext = {
  shop: string;
  viaAppProxy: boolean;
  identity: CustomerIdentity | null;
};

function cookieSecrets(): string[] {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (secret) return [secret];
  if (isProduction()) {
    // assertProductionEnv already refuses to boot without a secret; this keeps
    // the guarantee local to the cookie so a future caller cannot bypass it.
    throw new Error("SHOPIFY_API_SECRET is required to sign customer session cookies.");
  }
  return ["devsecret"];
}

const customerCookie = createCookie("upt_customer_session", {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction(),
  path: "/",
  secrets: cookieSecrets(),
});

function devShop(): string {
  return process.env.DEV_SHOP || DEMO_SHOP;
}

/**
 * Identity from a Shopify app proxy request, or null when the request did not
 * come through the proxy with a valid signature.
 */
export function readAppProxyContext(
  request: Request,
): { shop: string; loggedInCustomerId: string | null } | null {
  const search = new URL(request.url).searchParams;
  if (!search.has("signature")) return null;

  if (!appProxySignatureIsValid(search, process.env.SHOPIFY_API_SECRET ?? "")) {
    return null;
  }

  const shop = search.get("shop");
  if (!shop) return null;

  return {
    shop,
    loggedInCustomerId: search.get("logged_in_customer_id") || null,
  };
}

/**
 * Resolves the shop and, when available, the signed-in customer.
 *
 * Returns null when the shop cannot be established — in production that means
 * the request did not come through the app proxy and must not be served.
 */
export async function readCustomerContext(
  request: Request,
): Promise<CustomerContext | null> {
  const proxy = readAppProxyContext(request);
  if (proxy) {
    return {
      shop: proxy.shop,
      viaAppProxy: true,
      identity: proxy.loggedInCustomerId
        ? { email: "", name: "", shopifyCustomerId: proxy.loggedInCustomerId }
        : null,
    };
  }

  if (isProduction()) return null;

  const session = await readCookieSession(request);
  return {
    shop: session?.shop || devShop(),
    viaAppProxy: false,
    identity: session
      ? {
          email: session.email,
          name: session.name,
          shopifyCustomerId: session.shopifyCustomerId,
        }
      : null,
  };
}

async function readCookieSession(request: Request): Promise<CustomerSession | null> {
  const raw = await customerCookie.parse(request.headers.get("Cookie"));
  if (raw && typeof raw === "object" && "email" in raw) {
    return raw as CustomerSession;
  }
  return null;
}

export async function serializeCustomerSession(
  session: CustomerSession,
): Promise<string> {
  return customerCookie.serialize(session);
}

export async function destroyCustomerSession(): Promise<string> {
  return customerCookie.serialize("", { maxAge: 0 });
}

export function canUseDemoCustomerLogin(): boolean {
  if (isProduction()) return false;
  return isDevAdminBypass() || process.env.ALLOW_CUSTOMER_DEMO_LOGIN === "true";
}
