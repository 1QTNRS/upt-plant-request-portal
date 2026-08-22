import {
  buildCustomerOffer,
  closeRequest,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  getShopSettings,
  OfferAlreadyAnsweredError,
  OfferExpiredError,
  RequestClosedError,
  saveCustomerResponse,
} from "./portal.server";
import {
  notifyAdminResponse,
  notifyCheckoutLink,
  notifyResponseSummary,
} from "./emails.server";
import { createDraftOrderForRequest } from "./shopify-ops.server";
import type { AdminContext } from "./admin-auth.server";

export async function loadCustomerOfferPage(shop: string, requestId: string | null) {
  const settings = await getShopSettings(shop);
  if (!requestId) {
    return {
      offer: null,
      response: null,
      invoiceUrl: null as string | null,
      fedexRemovalWarning: settings.fedexRemovalWarning,
      requestClosed: false,
      requestPaid: false,
      paidAt: null as string | null,
    };
  }

  const offer = await buildCustomerOffer(shop, requestId);
  const response = await getCustomerResponse(shop, requestId);
  const request = await getRequest(shop, requestId);
  const draft = await getDraftOrder(shop, requestId);

  return {
    offer,
    response,
    invoiceUrl: draft?.invoiceUrl ?? null,
    fedexRemovalWarning: settings.fedexRemovalWarning,
    requestClosed: request?.status === "Closed",
    requestPaid: Boolean(request?.paidAt),
    paidAt: request?.paidAt ?? null,
  };
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
    const draft = await createDraftOrderForRequest(input.admin, input.shop, {
      requestId: input.requestId,
      requestNumber: request.requestNumber,
      customerEmail: request.email,
      acceptedItems: accepted.map((item) => ({
        plantName: item.plantName,
        quantity: item.quantity,
        price: item.price,
        weightLbs:
          request.items.find((entry) => entry.id === item.sourceItemId)?.weightLbs ?? 0,
      })),
      fedexSelected: response.fedexUpgradeSelected,
    });
    await notifyCheckoutLink(input.shop, input.requestId, draft.invoiceUrl);
    return { ok: true, invoiceUrl: draft.invoiceUrl };
  } catch (error) {
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
    await closeRequest(input.shop, input.requestId, "Customer closed request");
    return { ok: true as const };
  }

  // An offer is answered once. Re-posting (double click, refresh, retry) must
  // not overwrite the recorded choices, create a second draft order, or resend
  // the confirmation and checkout emails.
  const alreadyAnswered = await getCustomerResponse(input.shop, input.requestId);
  if (alreadyAnswered) {
    return { ok: true as const, alreadySubmitted: true as const };
  }

  const request = await getRequest(input.shop, input.requestId);

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
  let draft: Awaited<ReturnType<typeof createDraftOrderForRequest>> | null = null;
  try {
    draft = await createDraftOrderForRequest(input.admin, input.shop, {
      requestId: input.requestId,
      requestNumber: offer.requestNumber,
      customerEmail: offer.customerEmail,
      acceptedItems: accepted.map((item) => ({
        plantName: item.plantName,
        quantity: item.quantity,
        price: item.price,
        weightLbs:
          request?.items.find((entry) => entry.id === item.sourceItemId)?.weightLbs ??
          0,
      })),
      fedexSelected: fedexUpgradeSelected,
      fedexPrice: saved.fedexUpgradePrice,
    });
  } catch (error) {
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

  return { ok: true as const, draftOrderFailed: draft === null };
}
