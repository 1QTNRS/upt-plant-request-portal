import { buildConfirmationEmail } from "./portal";
import {
  buildCustomerOffer,
  closeRequest,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  getShopSettings,
  OfferAlreadyAnsweredError,
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
