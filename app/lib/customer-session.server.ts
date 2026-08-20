import { createCookie } from "react-router";

import { authenticate } from "../shopify.server";
import { isProductionRuntime } from "./environment.server";
import { DEMO_SHOP, isDevAdminBypass } from "./shop";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type AuthenticatedCustomer = {
  identity: CustomerIdentity;
  /**
   * Offline Admin API client for the shop that proxied the request. Present
   * whenever the app has a stored session, and needed so that customer-driven
   * actions (accepting an offer) can create real Shopify draft orders.
   */
  admin?: AdminGraphqlClient;
};

export type CustomerIdentity = {
  shop: string;
  email: string;
  name: string;
  shopifyCustomerId?: string;
  /**
   * `app-proxy` identities are cryptographically verified by Shopify.
   * `demo-cookie` identities exist only for local development.
   */
  source: "app-proxy" | "demo-cookie";
  /** True when we have both a contactable email and a stable identity. */
  canSubmitRequests: boolean;
};

/** Retained for backwards compatibility with existing call sites. */
export type CustomerSession = CustomerIdentity;

const customerCookie = createCookie("upt_customer_session", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: isProductionRuntime(),
  secrets: [process.env.SHOPIFY_API_SECRET || "devsecret"],
});

export function canUseDemoCustomerLogin(): boolean {
  if (isProductionRuntime()) return false;
  return isDevAdminBypass() || process.env.ALLOW_CUSTOMER_DEMO_LOGIN === "true";
}

/**
 * An App Proxy request carries a `signature` query parameter covering the whole
 * query string. Its presence is what tells us to run Shopify's HMAC check
 * instead of falling back to the development cookie.
 */
function isAppProxyRequest(request: Request): boolean {
  return new URL(request.url).searchParams.has("signature");
}

const CUSTOMER_QUERY = `#graphql
  query PortalCustomerIdentity($id: ID!) {
    customer(id: $id) {
      id
      email
      displayName
      firstName
      lastName
    }
  }
`;

type ShopifyCustomer = {
  id: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * The proxy only tells us *which* customer is signed in, never their name or
 * email, so we read those from the Admin API using the `read_customers` scope.
 */
async function fetchCustomerContactDetails(
  admin: AdminGraphqlClient | undefined,
  numericCustomerId: string,
): Promise<{ email: string; name: string }> {
  if (!admin) return { email: "", name: "" };

  try {
    const response = await admin.graphql(CUSTOMER_QUERY, {
      variables: { id: `gid://shopify/Customer/${numericCustomerId}` },
    });
    const body = (await response.json()) as {
      data?: { customer: ShopifyCustomer | null };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length || !body.data?.customer) {
      return { email: "", name: "" };
    }

    const customer = body.data.customer;
    const name =
      customer.displayName?.trim() ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
    return { email: customer.email?.trim().toLowerCase() ?? "", name };
  } catch {
    return { email: "", name: "" };
  }
}

/**
 * Resolves the signed-in storefront customer, along with the shop's Admin API
 * client when one is available.
 *
 * Returns `null` when nobody is authenticated. Throws Shopify's 400 response
 * when an App Proxy signature is present but invalid, so a forged
 * `logged_in_customer_id` can never reach the data layer.
 */
export async function authenticateCustomer(
  request: Request,
): Promise<AuthenticatedCustomer | null> {
  if (isAppProxyRequest(request)) {
    const { session, admin } = await authenticate.public.appProxy(request);

    const url = new URL(request.url);
    // Safe to trust: every one of these params is covered by the verified HMAC.
    const shop = session?.shop || url.searchParams.get("shop") || "";
    const loggedInCustomerId = (
      url.searchParams.get("logged_in_customer_id") || ""
    ).trim();

    if (!shop || !loggedInCustomerId) return null;

    const contact = await fetchCustomerContactDetails(admin, loggedInCustomerId);
    return {
      admin,
      identity: {
        shop,
        email: contact.email,
        name: contact.name,
        shopifyCustomerId: loggedInCustomerId,
        source: "app-proxy",
        canSubmitRequests: contact.email.length > 0,
      },
    };
  }

  if (!canUseDemoCustomerLogin()) return null;

  const raw = await customerCookie.parse(request.headers.get("Cookie"));
  if (raw && typeof raw === "object" && "email" in raw) {
    const cookieSession = raw as Partial<CustomerIdentity>;
    const email = (cookieSession.email ?? "").trim().toLowerCase();
    if (!email) return null;
    return {
      identity: {
        shop: cookieSession.shop || process.env.DEV_SHOP || DEMO_SHOP,
        email,
        name: cookieSession.name ?? "",
        shopifyCustomerId: cookieSession.shopifyCustomerId,
        source: "demo-cookie",
        canSubmitRequests: true,
      },
    };
  }

  return null;
}

export async function readCustomerSession(
  request: Request,
): Promise<CustomerIdentity | null> {
  const authenticated = await authenticateCustomer(request);
  return authenticated?.identity ?? null;
}

export async function serializeCustomerSession(
  session: Pick<CustomerIdentity, "shop" | "email" | "name" | "shopifyCustomerId">,
): Promise<string> {
  return customerCookie.serialize(session);
}

export async function destroyCustomerSession(): Promise<string> {
  return customerCookie.serialize("", { maxAge: 0 });
}

/**
 * Decides whether an identity may read a given request. Customers who have a
 * Shopify account id are matched on that id alone: matching on email as well
 * would let a customer who changed their account email reach another shopper's
 * request, and vice versa.
 */
export function identityOwnsRequest(
  identity: Pick<CustomerIdentity, "email" | "shopifyCustomerId">,
  plantRequest: { email?: string | null; shopifyCustomerId?: string | null } | null,
): boolean {
  if (!plantRequest) return false;

  if (identity.shopifyCustomerId && plantRequest.shopifyCustomerId) {
    return identity.shopifyCustomerId === plantRequest.shopifyCustomerId;
  }

  const identityEmail = identity.email.trim().toLowerCase();
  const requestEmail = (plantRequest.email ?? "").trim().toLowerCase();
  if (!identityEmail || !requestEmail) return false;

  // Only reachable for requests created before the customer linked a Shopify
  // account, which have no `shopifyCustomerId` to match on.
  return identityEmail === requestEmail;
}
