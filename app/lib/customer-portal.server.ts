import { randomUUID } from "node:crypto";

import { data } from "react-router";

import type { PlantLine } from "../components/customer-request-portal";

import { customerPortalRelativeLinks } from "./app-proxy";
import { shopifyCustomerLoginHref } from "./customer-nav";
import {
  plantLinesFromQuery,
  portalFormAction,
  portalHome,
  readExistingOrderAnswer,
} from "./customer-portal";
import {
  fetchShopifyCustomerAccountPhone,
  resolveCustomerIdentity,
} from "./customer-identity.server";
import {
  canUseDemoCustomerLogin,
  readCustomerContext,
  type CustomerContext,
} from "./customer-session.server";
import { getDisplayRequestNumber, type CustomerMyRequestRow } from "./portal";
import { formatCustomerDate } from "./customer-time";
import { readSmsNotifyEnabled, readSmsPhone } from "./customer-sms";
import {
  findOrCreateCustomer,
  getCustomerSmsNotifyPreference,
  getCustomerTimeZone,
  listCustomerRequests,
} from "./portal.server";
import { ensureShopSeeded } from "./seed-demo.server";

/**
 * Shared by the portal page and the form's POST target.
 *
 * Both routes have to render the same page: the POST target renders it after
 * a submit (or when validation fails), and the GET fallback for add/remove
 * plant also lands here. Keeping one loader means the two cannot drift.
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
  /**
   * Storefront Shopify login that returns to this portal page. Null on the
   * local `/customer` demo, which has no shop login.
   */
  loginHref: string | null;
  requestDetailBase: string;
  canSubmitRequests: boolean;
  identityError: string | null;
  submittedMessage: string | null;
  formAction: string;
  browseAction: string;
  /** Rows carried in the query string by the add/remove buttons. */
  plantLines: PlantLine[] | null;
  /** Carried in the query string so Yes/No survives add/remove plant. */
  hasExistingOrder: "yes" | "no" | null;
  smsNotifyEnabled: boolean;
  /** Typed or stored portal SMS number (not consent until checkbox is on). */
  smsPhone: string;
  /** Shopify account phone for prefill only; never implies SMS consent. */
  shopifyPhonePrefill: string | null;
  /** One per page load; deduplicates a double submit or retried POST. */
  submissionNonce: string;
  customerTimeZone: string | null;
};

function toRequestRow(
  request: Awaited<ReturnType<typeof listCustomerRequests>>[number],
  timeZone: string | null,
): CustomerMyRequestRow {
  return {
    id: request.id,
    requestNumber: getDisplayRequestNumber(request),
    submittedDate: formatCustomerDate(new Date(request.submittedAtIso), timeZone),
    plantsRequested: request.items.map((item) => item.plantName).join(", "),
    status: request.status,
    hasPayableItems: request.hasPayableItems,
    hasResponded: request.hasResponded,
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
    loginHref: context.viaAppProxy ? shopifyCustomerLoginHref(links.home) : null,
    requestDetailBase: links.home,
    formAction: portalFormAction(context),
    browseAction: portalHome(context),
    plantLines: plantLinesFromQuery(search),
    hasExistingOrder: readExistingOrderAnswer(search),
    smsNotifyEnabled: readSmsNotifyEnabled(search),
    smsPhone: readSmsPhone(search),
    shopifyPhonePrefill: null,
    submissionNonce: randomUUID(),
    submittedMessage: submittedNumber
      ? `Request submitted. Your request number is ${submittedNumber}. We'll notify you when matching plants become available.`
      : null,
    customerTimeZone: null as string | null,
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
        myRequests: requests.map((request) => toRequestRow(request, null)),
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
  const customerTimeZone = await getCustomerTimeZone(customer.shop, customer.email);
  const smsPrefs = await getCustomerSmsNotifyPreference(customer.shop, customer.email);
  const shopifyPhonePrefill = identity.shopifyCustomerId
    ? await fetchShopifyCustomerAccountPhone(context.shop, identity.shopifyCustomerId)
    : null;
  const smsFromQuery = search.has("smsNotifyEnabled") || search.has("smsNotifyPhone");

  return {
    context,
    portal: {
      ...shared,
      loggedIn: true,
      name: customer.name,
      email: customer.email,
      canSubmitRequests: true,
      identityError: null,
      myRequests: requests.map((request) => toRequestRow(request, customerTimeZone)),
      customerTimeZone,
      shopifyPhonePrefill,
      smsNotifyEnabled: smsFromQuery ? shared.smsNotifyEnabled : smsPrefs.optIn,
      smsPhone: smsFromQuery
        ? shared.smsPhone
        : smsPrefs.optIn
          ? smsPrefs.phone ?? ""
          : "",
    },
  };
}
