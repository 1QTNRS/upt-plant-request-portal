import { data } from "react-router";

import type { PlantLine } from "../components/customer-request-portal";

import { customerPortalRelativeLinks } from "./app-proxy";
import {
  plantLinesFromQuery,
  portalFormAction,
  portalHome,
} from "./customer-portal";
import { resolveCustomerIdentity } from "./customer-identity.server";
import {
  canUseDemoCustomerLogin,
  readCustomerContext,
  type CustomerContext,
} from "./customer-session.server";
import { getDisplayRequestNumber, type CustomerMyRequestRow } from "./portal";
import { findOrCreateCustomer, listCustomerRequests } from "./portal.server";
import { ensureShopSeeded } from "./seed-demo.server";

/**
 * Shared by the portal page and the form's POST target.
 *
 * Both routes have to render the same page: the POST target renders it after
 * adding or removing a plant row, or when validation fails. Keeping one loader
 * means the two cannot drift.
 */
/**
 * Shown when the app cannot reach Shopify to identify the visitor. It has to
 * read as our problem, not theirs: the customer's account is fine and there is
 * nothing for them to change.
 */
export const CUSTOMER_LOOKUP_UNAVAILABLE =
  "We can't reach your store account right now, so we can't load your requests " +
  "or take a new one. This is a problem on our side — please try again in a few " +
  "minutes.";

export type CustomerPortalData = {
  loggedIn: boolean;
  name: string;
  email: string;
  myRequests: CustomerMyRequestRow[];
  showDemoLogin: boolean;
  requestDetailBase: string;
  canSubmitRequests: boolean;
  identityError: string | null;
  submittedMessage: string | null;
  formAction: string;
  browseAction: string;
  /** Rows carried in the query string by the add/remove buttons. */
  plantLines: PlantLine[] | null;
};

function toRequestRow(
  request: Awaited<ReturnType<typeof listCustomerRequests>>[number],
): CustomerMyRequestRow {
  return {
    id: request.id,
    requestNumber: getDisplayRequestNumber(request),
    submittedDate: request.submittedDate,
    plantsRequested: request.items.map((item) => item.plantName).join(", "),
    status: request.status,
    hasPayableItems: request.hasPayableItems,
  };
}

export async function loadCustomerPortal(
  request: Request,
): Promise<{ context: CustomerContext; portal: CustomerPortalData }> {
  const context = await readCustomerContext(request);
  // In production this means the request did not come through the app proxy.
  if (!context) throw data("Not found", { status: 404 });

  // Never seeds a real shop; keeps the settings row present for one.
  await ensureShopSeeded(context.shop);

  const links = customerPortalRelativeLinks(context.viaAppProxy);
  const search = new URL(request.url).searchParams;
  const submittedNumber = search.get("submitted");
  const shared = {
    showDemoLogin: canUseDemoCustomerLogin(),
    requestDetailBase: links.home,
    formAction: portalFormAction(context),
    browseAction: portalHome(context),
    plantLines: plantLinesFromQuery(search),
    submittedMessage: submittedNumber
      ? `Request submitted. Your request number is ${submittedNumber}. We'll notify you when matching plants become available.`
      : null,
  };

  const signedOut: CustomerPortalData = {
    ...shared,
    loggedIn: false,
    name: "",
    email: "",
    myRequests: [],
    canSubmitRequests: false,
    identityError: null,
  };

  if (!context.identity) return { context, portal: signedOut };

  const identity = await resolveCustomerIdentity(context.shop, context.identity);

  // Without an email the request cannot be attributed or acknowledged, and
  // `CustomerProfile` is keyed on (shop, email) so a blank one would collapse
  // every unidentified shopper into a single shared profile. The customer can
  // still read the requests already linked to their Shopify account id.
  if (!identity.email.trim()) {
    if (!identity.shopifyCustomerId) return { context, portal: signedOut };
    const requests = await listCustomerRequests(context.shop, {
      shopifyCustomerId: identity.shopifyCustomerId,
    });
    return {
      context,
      portal: {
        ...shared,
        loggedIn: true,
        name: identity.name,
        email: "",
        canSubmitRequests: false,
        identityError: identity.shopUnreachable
          ? CUSTOMER_LOOKUP_UNAVAILABLE
          : "We could not read the email address on your store account. Add an email to your account to submit a new plant request.",
        myRequests: requests.map(toRequestRow),
      },
    };
  }

  const customer = await findOrCreateCustomer(context.shop, {
    name: identity.name,
    email: identity.email,
    shopifyCustomerId: identity.shopifyCustomerId,
  });
  const requests = await listCustomerRequests(customer.shop, {
    email: customer.email,
    shopifyCustomerId: customer.shopifyCustomerId ?? undefined,
  });

  return {
    context,
    portal: {
      ...shared,
      loggedIn: true,
      name: customer.name,
      email: customer.email,
      canSubmitRequests: true,
      identityError: null,
      myRequests: requests.map(toRequestRow),
    },
  };
}
