export type CustomerIdentityRef = {
  email: string;
  shopifyCustomerId?: string;
};

export type OwnableRequestRef = {
  email?: string | null;
  shopifyCustomerId?: string | null;
};

/**
 * Decides whether an identity may read a given request.
 *
 * Customers who have a Shopify account id are matched on that id alone.
 * Falling back to email as well would let someone who changed their account
 * email reach a stranger's request, and would expose a customer's requests to
 * whoever later claims their old address.
 */
export function identityOwnsRequest(
  identity: CustomerIdentityRef,
  plantRequest: OwnableRequestRef | null,
): boolean {
  if (!plantRequest) return false;

  if (identity.shopifyCustomerId && plantRequest.shopifyCustomerId) {
    return identity.shopifyCustomerId === plantRequest.shopifyCustomerId;
  }

  // A request already claimed by a different account is never reachable by
  // email, even when the addresses match.
  if (plantRequest.shopifyCustomerId && !identity.shopifyCustomerId) return false;

  const identityEmail = identity.email.trim().toLowerCase();
  const requestEmail = (plantRequest.email ?? "").trim().toLowerCase();
  if (!identityEmail || !requestEmail) return false;

  // Only reachable for requests submitted before the customer linked a Shopify
  // account, which carry no id to match on.
  return identityEmail === requestEmail;
}
