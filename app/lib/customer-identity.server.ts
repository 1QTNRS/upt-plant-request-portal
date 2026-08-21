import prisma from "../db.server";
import type { CustomerIdentity } from "./customer-session.server";
import { offlineAdminClient, type AdminGraphqlClient } from "./offline-admin.server";

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
): Promise<CustomerIdentity> {
  if (identity.email.trim() && identity.name.trim()) return identity;
  if (!identity.shopifyCustomerId) return identity;

  const known = await prisma.customerProfile.findFirst({
    where: { shop, shopifyCustomerId: identity.shopifyCustomerId },
  });
  if (known?.email) {
    return {
      email: known.email,
      name: known.name || identity.name,
      shopifyCustomerId: identity.shopifyCustomerId,
    };
  }

  const admin = await offlineAdminClient(shop);
  if (!admin) return identity;

  try {
    const fetched = await fetchIdentityFromShopify(
      admin,
      identity.shopifyCustomerId,
    );
    if (!fetched?.email) return identity;
    return {
      email: fetched.email,
      name: fetched.name || identity.name,
      shopifyCustomerId: identity.shopifyCustomerId,
    };
  } catch (error) {
    console.error(
      `Could not read Shopify customer ${identity.shopifyCustomerId} for ${shop}.`,
      error,
    );
    return identity;
  }
}
