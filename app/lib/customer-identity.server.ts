import prisma from "../db.server";
import type { CustomerIdentity } from "./customer-session.server";
import { offlineAdminClient, type AdminGraphqlClient } from "./offline-admin.server";
import { isDevAdminBypass } from "./shop";

/**
 * An identity plus why it might be incomplete.
 *
 * "Shopify has no email for this customer" and "we could not ask Shopify" look
 * identical to a caller reading `email`, but they are opposite messages: one is
 * something the customer can fix on their account, the other is an outage on
 * our side. Telling a customer to add an email they already have, because the
 * app lost its Shopify session, sends them to fix the wrong thing.
 */
export type ResolvedCustomerIdentity = CustomerIdentity & {
  /** The Admin API could not be reached or refused the lookup. */
  shopUnreachable: boolean;
};

const CUSTOMER_QUERY = `#graphql
  query PortalCustomerIdentity($id: ID!) {
    customer(id: $id) {
      id
      displayName
      firstName
      lastName
      defaultEmailAddress { emailAddress }
    }
  }
`;

type CustomerQueryResult = {
  customer: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    defaultEmailAddress: { emailAddress: string | null } | null;
  } | null;
};

/**
 * The app proxy only forwards a customer id, so the id has to be turned into a
 * name and email before a request can be attributed or an email sent. Accepts
 * the bare numeric id the proxy sends as well as a full GID.
 */
export function customerGid(shopifyCustomerId: string): string {
  return shopifyCustomerId.startsWith("gid://")
    ? shopifyCustomerId
    : `gid://shopify/Customer/${shopifyCustomerId}`;
}

async function fetchIdentityFromShopify(
  admin: AdminGraphqlClient,
  shopifyCustomerId: string,
): Promise<CustomerIdentity | null> {
  const response = await admin.graphql(CUSTOMER_QUERY, {
    variables: { id: customerGid(shopifyCustomerId) },
  });
  const body = (await response.json()) as {
    data?: CustomerQueryResult;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }

  const customer = body.data?.customer;
  if (!customer) return null;

  const email = customer.defaultEmailAddress?.emailAddress?.trim() ?? "";
  const name =
    customer.displayName?.trim() ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();

  return { email, name, shopifyCustomerId };
}

/**
 * Fills in the name and email for an app-proxy identity.
 *
 * Prefers the stored `CustomerProfile` so the storefront does not spend an
 * Admin API call on every page load, and only calls Shopify for a customer the
 * portal has not seen before. Returns the identity unchanged when Shopify
 * cannot be reached, so the portal degrades to "not signed in" rather than
 * attributing the request to the wrong person.
 */
export async function resolveCustomerIdentity(
  shop: string,
  identity: CustomerIdentity,
): Promise<ResolvedCustomerIdentity> {
  const resolved = { ...identity, shopUnreachable: false };
  if (identity.email.trim() && identity.name.trim()) return resolved;
  if (!identity.shopifyCustomerId) return resolved;

  const known = await prisma.customerProfile.findFirst({
    where: { shop, shopifyCustomerId: identity.shopifyCustomerId },
  });
  if (known?.email) {
    return {
      email: known.email,
      name: known.name || identity.name,
      shopifyCustomerId: identity.shopifyCustomerId,
      shopUnreachable: false,
    };
  }

  const admin = await offlineAdminClient(shop);
  // The local dev bypass has no Admin client on purpose; that is not an outage.
  if (!admin) return { ...resolved, shopUnreachable: !isDevAdminBypass() };

  try {
    const fetched = await fetchIdentityFromShopify(
      admin,
      identity.shopifyCustomerId,
    );
    // A customer Shopify does know, but with no email on the account.
    if (!fetched?.email) return resolved;
    return {
      email: fetched.email,
      name: fetched.name || identity.name,
      shopifyCustomerId: identity.shopifyCustomerId,
      shopUnreachable: false,
    };
  } catch (error) {
    console.error(
      `Could not read Shopify customer ${identity.shopifyCustomerId} for ${shop}.`,
      error,
    );
    return { ...resolved, shopUnreachable: true };
  }
}
