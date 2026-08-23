import {
  voidExpiredDraftOrder,
  voidUnpaidDraftOrder,
} from "./draft-order-void.server";
import {
  ADMIN_OVERRIDE_CLOSE_REASON,
  CUSTOMER_CLOSED_REQUEST_REASON,
  INVOICE_VOIDED_BY_ADMIN_REASON,
  INVOICE_VOIDED_BY_CUSTOMER_CLOSE_REASON,
  payableInvoiceUrl,
  type RequestStatus,
} from "./portal";
import {
  customerCanCloseRequest,
  declinedAllPurchasableItems,
  fedexRemovalNeedsConfirmation,
  readOfferChoices,
} from "./customer-portal";
import { formatCustomerDateTime } from "./customer-time";
import {
  acceptedOfferLines,
  buildCustomerOffer,
  clearFulfillmentIssues,
  closeRequest,
  expireOverdueOffers,
  getCustomerResponse,
  getCustomerTimeZone,
  getDraftOrder,
  getRequest,
  getShopSettings,
  OfferAlreadyAnsweredError,
  OfferExpiredError,
  recordFulfillmentIssues,
  RequestClosedError,
  saveCustomerResponse,
} from "./portal.server";
import {
  notifyAdminResponse,
  notifyCheckoutLink,
  notifyResponseSummary,
} from "./emails.server";
import {
  createDraftOrderForRequest,
  InsufficientStockError,
} from "./shopify-ops.server";
import { RESERVATION_NOT_CONFIRMED } from "./growers-choice";
import type { AdminContext } from "./admin-auth.server";

export async function loadCustomerOfferPage(
  shop: string,
  requestId: string | null,
  admin?: Parameters<typeof voidExpiredDraftOrder>[2],
) {
  const settings = await getShopSettings(shop);
  if (!requestId) {
    return {
      offer: null,
      response: null,
      invoiceUrl: null as string | null,
      fedexRemovalWarning: settings.fedexRemovalWarning,
      requestClosed: false,
      requestPaid: false,
      requestStatus: null as RequestStatus | null,
      paidAt: null as string | null,
      paidAtIso: null as string | null,
      customerTimeZone: null as string | null,
    };
  }

  await expireOverdueOffers(shop);
  if (admin) {
    await voidExpiredDraftOrder(shop, requestId, admin);
  }

  const offer = await buildCustomerOffer(shop, requestId);
  const response = await getCustomerResponse(shop, requestId);
  const request = await getRequest(shop, requestId);
  const draft = await getDraftOrder(shop, requestId);
  const timeZone = request
    ? await getCustomerTimeZone(shop, request.email)
    : null;

  return {
    offer,
    response,
    invoiceUrl: payableInvoiceUrl({
      invoiceUrl: draft?.invoiceUrl,
      voidedAt: draft?.voidedAt,
      requestClosed: request?.status === "Closed",
      requestPaid: Boolean(request?.paidAt),
      expiresAtIso: offer?.expiresAtIso,
    }),
    fedexRemovalWarning: settings.fedexRemovalWarning,
    requestClosed: request?.status === "Closed",
    requestPaid: Boolean(request?.paidAt),
    requestStatus: request?.status ?? null,
    paidAt: request?.paidAtIso
      ? formatCustomerDateTime(new Date(request.paidAtIso), timeZone)
      : null,
    paidAtIso: request?.paidAtIso ?? null,
    customerTimeZone: timeZone,
  };
}

/**
 * Creates the draft order for an answered offer from the frozen snapshots.
 *
 * The one place a draft order is created from, so the customer's own submission
 * and the admin's recovery button bill identically, ask Shopify for the same
 * hold, and leave the same record of whether the hold was granted.
 */
async function createDraftOrderFromSnapshot(input: {
  shop: string;
  requestId: string;
  requestNumber: string;
  customerEmail: string;
  fedexSelected: boolean;
  fedexPrice: number;
  admin?: AdminContext["admin"];
}) {
  const { items, holdEndsAt } = await acceptedOfferLines(input.shop, input.requestId);
  const draft = await createDraftOrderForRequest(input.admin, input.shop, {
    requestId: input.requestId,
    requestNumber: input.requestNumber,
    customerEmail: input.customerEmail,
    acceptedItems: items,
    fedexSelected: input.fedexSelected,
    fedexPrice: input.fedexPrice,
    holdEndsAt,
  });

  if (draft.inventoryReserved) {
    // Whatever a previous attempt could not hold, this one did.
    await clearFulfillmentIssues(input.shop, input.requestId);
  } else {
    // Shopify took the order but not the hold. The customer can still pay, so
    // the order stands — but the plant is on open sale and only the merchant
    // can act on that.
    await recordFulfillmentIssues(
      input.shop,
      input.requestId,
      items
        .filter((item) => item.variantId)
        .map((item) => ({
          itemId: item.itemId,
          reason: `${item.plantName}: ${RESERVATION_NOT_CONFIRMED}`,
        })),
    );
  }

  return draft;
}

/**
 * Creates the draft order and emails the payment link for a request the
 * customer has already accepted.
 *
 * The customer's own submission is otherwise the only caller of
 * `createDraftOrderForRequest`, and re-submitting an answered offer returns
 * `alreadySubmitted` without retrying, so a Shopify outage at that one moment
 * left the request permanently unpayable. `checkout_link:{requestId}` is a key
 * the confirmation never used, so the mail actually goes out.
 *
 * Idempotent through `createDraftOrderForRequest`, which reuses a recorded or
 * tagged draft order rather than creating a second one.
 */
export async function createPaymentLinkForRequest(input: {
  shop: string;
  requestId: string;
  admin?: AdminContext["admin"];
}): Promise<{ ok: true; invoiceUrl: string } | { ok: false; error: string }> {
  const response = await getCustomerResponse(input.shop, input.requestId);
  if (!response) {
    return { ok: false, error: "The customer has not answered this offer yet." };
  }

  const accepted = response.items.filter((item) => item.choice === "accept");
  if (accepted.length === 0) {
    return {
      ok: false,
      error:
        "This customer accepted no plants, so there is nothing to charge for. Draft orders are only created for accepted plants.",
    };
  }

  const request = await getRequest(input.shop, input.requestId);
  if (!request) return { ok: false, error: "This request could not be loaded." };

  try {
    const draft = await createDraftOrderFromSnapshot({
      shop: input.shop,
      requestId: input.requestId,
      requestNumber: request.requestNumber,
      customerEmail: request.email,
      fedexSelected: response.fedexUpgradeSelected,
      fedexPrice: response.fedexUpgradePrice,
      admin: input.admin,
    });
    await notifyCheckoutLink(input.shop, input.requestId, draft.invoiceUrl);
    return { ok: true, invoiceUrl: draft.invoiceUrl };
  } catch (error) {
    // Stock that has gone is not a payment-link failure to retry: the message
    // says what the merchant has to do about it, and wrapping it would bury
    // that behind an instruction to try again.
    if (error instanceof InsufficientStockError) {
      await recordFulfillmentIssues(
        input.shop,
        input.requestId,
        error.shortfalls.map((shortfall) => ({
          itemId: shortfall.itemId,
          reason: shortfall.reason,
        })),
      );
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: `Could not create the payment link: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

/**
 * Ends a request whose customer answered by accepting nothing.
 *
 * Refused while anything is accepted: that request either still owes money or
 * is waiting for `orders/paid` to close it, and closing it here would strand a
 * live hold and withdraw the customer's own checkout link.
 *
 * Closing does not touch the offer or response snapshots, so the declined
 * history the customer and the analytics read stays intact, and the declined
 * plants stay eligible for an EXACT PLANTS listing — closing tidies the request
 * away, it does not decide the plants are spoken for.
 */
export async function closeDeclinedRequest(input: {
  shop: string;
  requestId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await getCustomerResponse(input.shop, input.requestId);
  if (!response) {
    return {
      ok: false,
      error: "The customer has not answered this offer yet, so there is nothing to close.",
    };
  }
  if (response.hasAcceptedPurchasableItems) {
    return {
      ok: false,
      error:
        "This customer accepted plants, so the request stays open until they pay or the hold expires.",
    };
  }

  await closeRequest(
    input.shop,
    input.requestId,
    "Admin closed request — customer declined every item",
  );
  return { ok: true };
}

/**
 * Admin-only path that ends a request the normal workflow has not closed.
 *
 * Unlike `closeDeclinedRequest`, this may run while plants are still accepted
 * or while nobody has answered. History, offer snapshots and accept/reject
 * answers stay put. Declined Exact Plants stay eligible for EXACT PLANTS —
 * closing does not decide they are spoken for. An unpaid live Draft Order is
 * voided with the same delete/COMPLETED-skip rules as expiration so a payable
 * invoice is not left behind.
 *
 * Confirmation is required. A second call on an already-Closed request does
 * not write another close event; it only retries a void that has not landed.
 */
export async function adminOverrideCloseRequest(input: {
  shop: string;
  requestId: string;
  admin?: AdminContext["admin"];
  confirmed: boolean;
}): Promise<
  | { ok: true; alreadyClosed: boolean }
  | { ok: false; error: string; pendingAdminOverrideClose?: boolean }
> {
  if (!input.confirmed) {
    return {
      ok: false,
      error: "Confirm Close Entire Request to proceed.",
      pendingAdminOverrideClose: true,
    };
  }

  const request = await getRequest(input.shop, input.requestId);
  if (!request) {
    return { ok: false, error: "This request could not be loaded." };
  }

  const alreadyClosed = request.status === "Closed";
  if (!alreadyClosed) {
    await closeRequest(
      input.shop,
      input.requestId,
      ADMIN_OVERRIDE_CLOSE_REASON,
    );
  }

  await voidUnpaidDraftOrder(
    input.shop,
    input.requestId,
    input.admin,
    new Date(),
    { reason: INVOICE_VOIDED_BY_ADMIN_REASON },
  );

  return { ok: true, alreadyClosed };
}

/**
 * Customer Close Request after a submitted decline-all (or all-unavailable)
 * answer that reached No Payment Needed.
 *
 * History stays put. Unclaimed Exact Plants stay eligible under
 * `exactPlantReleaseReason`; Grower's Choice stays excluded. A leftover
 * payable Draft Order is voided so No Payment Needed cannot keep an invoice.
 */
export async function customerCloseRequest(input: {
  shop: string;
  requestId: string;
  admin?: AdminContext["admin"];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await getRequest(input.shop, input.requestId);
  if (!request) {
    return { ok: false, error: "This request could not be loaded." };
  }

  const response = await getCustomerResponse(input.shop, input.requestId);
  const acceptedCount =
    response?.items.filter((item) => item.choice === "accept").length ?? 0;
  const canClose = customerCanCloseRequest({
    requestClosed: request.status === "Closed",
    hasResponded: Boolean(response) || request.hasResponded,
    hasPayableItems: request.hasPayableItems,
    acceptedCount,
    declinedAllAvailable: declinedAllPurchasableItems({
      offerItems: request.items,
      responseItems: response?.items ?? null,
    }),
  });

  if (!canClose) {
    if (request.status === "Closed") {
      return { ok: true };
    }
    return {
      ok: false,
      error:
        "Close Request is only available after you decline every available plant and no payment is needed.",
    };
  }

  if (request.status !== "Closed") {
    await closeRequest(
      input.shop,
      input.requestId,
      CUSTOMER_CLOSED_REQUEST_REASON,
    );
  }

  await voidUnpaidDraftOrder(
    input.shop,
    input.requestId,
    input.admin,
    new Date(),
    { reason: INVOICE_VOIDED_BY_CUSTOMER_CLOSE_REASON },
  );

  return { ok: true };
}

export async function handleCustomerOfferAction(input: {
  shop: string;
  requestId: string;
  form: FormData;
  admin?: AdminContext["admin"];
}) {
  const intent = String(input.form.get("intent") || "");
  const offer = await buildCustomerOffer(input.shop, input.requestId);
  if (!offer) return { ok: false as const };

  if (intent === "close-request") {
    return customerCloseRequest({
      shop: input.shop,
      requestId: input.requestId,
      admin: input.admin,
    });
  }

  // An offer is answered once. Re-posting (double click, refresh, retry) must
  // not overwrite the recorded choices, create a second draft order, or resend
  // the confirmation and checkout emails.
  const alreadyAnswered = await getCustomerResponse(input.shop, input.requestId);
  if (alreadyAnswered) {
    return { ok: true as const, alreadySubmitted: true as const };
  }

  // Every available plant needs a deliberate answer. Defaulting a missing field
  // to `accept` would turn a form the customer never completed into a purchase,
  // and the `required` attribute on the radios only binds a real browser.
  const missingChoices = offer.items
    .filter((item) => item.availability === "available")
    .filter((item) => {
      const choice = input.form.get(`choice-${item.sourceItemId}`);
      return choice !== "accept" && choice !== "reject";
    })
    .map((item) => item.plantName);

  if (missingChoices.length > 0) {
    return {
      ok: false as const,
      missingChoices,
      error:
        missingChoices.length === 1
          ? `Choose Accept or Reject for ${missingChoices[0]}.`
          : `Choose Accept or Reject for each plant: ${missingChoices.join(", ")}.`,
    };
  }

  if (
    fedexRemovalNeedsConfirmation({
      choices: readOfferChoices(input.form),
      fedexSelected: String(input.form.get("fedexUpgradeSelected")) === "true",
      acknowledged: String(input.form.get("fedexRemovalAcknowledged")) === "true",
    })
  ) {
    return {
      ok: false as const,
      pendingFedexRemoval: true as const,
      error: null,
    };
  }

  const items = offer.items.map((item) => {
    const available = item.availability === "available";
    const choice = available
      ? (String(input.form.get(`choice-${item.sourceItemId}`)) as
          | "accept"
          | "reject")
      : ("unavailable" as const);
    return {
      offerItemId: item.id,
      sourceItemId: item.sourceItemId,
      plantName: item.plantName,
      choice,
      price: item.price,
      quantity: item.quantity,
      lineRevenue: choice === "accept" ? item.price * item.quantity : 0,
      customerNotes: item.notesFromUpt,
      photoUrls: item.photoUrls,
      unavailableReason: item.unavailableReason,
      // Taken from the offer, which is the thing the customer answered.
      fulfillmentType: item.fulfillmentType,
      linkedProductTitle: item.listingProductTitle,
      linkedVariantTitle: item.listingVariantTitle,
      linkedVariantGid: item.listingVariantGid,
      linkedImageUrl: item.listingImageUrl,
    };
  });

  // The upgrade only ever ships accepted plants. With nothing accepted there is
  // no shipment to upgrade, so it is recorded as unselected rather than made
  // the customer's problem to untick.
  const acceptedAnything = items.some((item) => item.choice === "accept");
  const fedexUpgradeSelected =
    acceptedAnything && String(input.form.get("fedexUpgradeSelected")) === "true";

  let saved;
  try {
    saved = await saveCustomerResponse(input.shop, {
      requestId: input.requestId,
      items,
      fedexUpgradeSelected,
      fedexUpgradePrice: offer.fedexUpgradePrice,
    });
  } catch (error) {
    // Lost a race with a concurrent submit of the same offer.
    if (error instanceof OfferAlreadyAnsweredError) {
      return { ok: true as const, alreadySubmitted: true as const };
    }
    // The hold lapsed between loading the page and submitting it, which the
    // expiry sweep inside the read makes the customer's own submit trigger.
    if (error instanceof OfferExpiredError) {
      return {
        ok: false as const,
        error:
          "This offer expired before your answer reached us. Please contact us and we will see whether the plant is still available.",
      };
    }
    if (error instanceof RequestClosedError) {
      return {
        ok: false as const,
        error:
          "This request is already closed, so we did not record an answer. Please contact us if that is not what you expected.",
      };
    }
    throw error;
  }

  const accepted = saved.items.filter((item) => item.choice === "accept");
  const rejected = saved.items.filter((item) => item.choice === "reject");
  const summaryItem = (item: (typeof saved.items)[number]) => ({
    plantName: item.plantName,
    price: item.price,
    customerNotes: item.customerNotes,
    fulfillmentType: item.fulfillmentType,
  });

  if (accepted.length === 0) {
    // No draft order, no payment link, no FedEx charge — but the customer and
    // UPT both still get their one email about the answer.
    await notifyResponseSummary(input.shop, {
      requestId: input.requestId,
      acceptedItems: [],
      rejectedItems: rejected.map(summaryItem),
      fedexSelected: false,
      fedexPrice: saved.fedexUpgradePrice,
    });
    await notifyAdminResponse(input.shop, {
      requestId: input.requestId,
      acceptedCount: 0,
      rejectedCount: rejected.length,
    });
    return { ok: true as const, draftOrderFailed: false };
  }

  // The response is already committed, so a Shopify outage must not roll the
  // customer's accept/reject choices back or surface as a failed submission.
  // The request stays Pending, which keeps it in the expiry and reminder sweeps.
  let draft: Awaited<ReturnType<typeof createDraftOrderFromSnapshot>> | null = null;
  let stockFailure: string | null = null;
  try {
    draft = await createDraftOrderFromSnapshot({
      shop: input.shop,
      requestId: input.requestId,
      requestNumber: offer.requestNumber,
      customerEmail: offer.customerEmail,
      fedexSelected: fedexUpgradeSelected,
      fedexPrice: saved.fedexUpgradePrice,
      admin: input.admin,
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      // Never an oversell: no draft order exists, so nothing is payable and
      // nothing was deducted. The customer keeps the answer they gave and hears
      // about the plant from a person, which is the only sensible way to be
      // told the plant sold while you were deciding.
      stockFailure = error.message;
      await recordFulfillmentIssues(
        input.shop,
        input.requestId,
        error.shortfalls.map((shortfall) => ({
          itemId: shortfall.itemId,
          reason: shortfall.reason,
        })),
      );
    }
    console.error(
      `Could not create a Shopify draft order for ${offer.requestNumber} on ${input.shop}.`,
      error,
    );
  }

  await notifyResponseSummary(input.shop, {
    requestId: input.requestId,
    acceptedItems: accepted.map(summaryItem),
    rejectedItems: rejected.map(summaryItem),
    fedexSelected: fedexUpgradeSelected,
    fedexPrice: saved.fedexUpgradePrice,
    invoiceUrl: draft?.invoiceUrl,
  });
  await notifyAdminResponse(input.shop, {
    requestId: input.requestId,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
  });

  return {
    ok: true as const,
    draftOrderFailed: draft === null,
    stockFailure,
  };
}
