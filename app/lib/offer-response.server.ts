import { buildConfirmationEmail } from "./portal";
import {
  buildCustomerOffer,
  closeRequest,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  getShopSettings,
  OfferAlreadyAnsweredError,
  OfferExpiredError,
  saveCustomerResponse,
} from "./portal.server";
import { notifyCheckoutLink, notifyConfirmation } from "./emails.server";
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
      confirmationEmail: null as ReturnType<typeof buildConfirmationEmail> | null,
    };
  }

  const offer = await buildCustomerOffer(shop, requestId);
  const response = await getCustomerResponse(shop, requestId);
  const request = await getRequest(shop, requestId);
  const draft = await getDraftOrder(shop, requestId);
  const confirmationEmail =
    response && offer
      ? buildConfirmationEmail({
          customerName: offer.customerName,
          customerEmail: offer.customerEmail,
          requestNumber: offer.requestNumber,
          acceptedItems: response.items
            .filter((item) => item.choice === "accept")
            .map((item) => ({
              plantName: item.plantName,
              price: item.price,
              quantity: item.quantity,
              customerNotes: item.customerNotes,
            })),
          fedexSelected: response.fedexUpgradeSelected,
          fedexPrice: response.fedexUpgradePrice,
          fedexDisclaimer: response.fedexUpgradeSelected
            ? undefined
            : settings.fedexRemovalWarning,
          invoiceUrl: draft?.invoiceUrl ?? undefined,
        })
      : null;

  return {
    offer,
    response,
    invoiceUrl: draft?.invoiceUrl ?? null,
    fedexRemovalWarning: settings.fedexRemovalWarning,
    requestClosed: request?.status === "Closed",
    confirmationEmail,
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
  const fedexUpgradeSelected =
    String(input.form.get("fedexUpgradeSelected")) === "true";

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
    throw error;
  }

  const accepted = saved.items.filter((item) => item.choice === "accept");
  if (accepted.length === 0) {
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

  await notifyConfirmation(input.shop, {
    requestId: input.requestId,
    acceptedItems: accepted.map((item) => ({
      plantName: item.plantName,
      price: item.price,
      quantity: item.quantity,
      customerNotes: item.customerNotes,
    })),
    fedexSelected: fedexUpgradeSelected,
    fedexPrice: offer.fedexUpgradePrice,
    invoiceUrl: draft?.invoiceUrl,
  });

  if (draft) {
    await notifyCheckoutLink(input.shop, input.requestId, draft.invoiceUrl);
  }

  return { ok: true as const, draftOrderFailed: draft === null };
}
