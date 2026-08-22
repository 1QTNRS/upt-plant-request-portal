import { useEffect, useState, type ChangeEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import { canStubShopifyWrites } from "../lib/environment.server";
import {
  listEmailsForRequest,
  notifyOfferReady,
  redeliverEmailMessage,
} from "../lib/emails.server";
import { shopifyAdminProductUrl } from "../lib/exact-plants";
import { listExactPlantCandidates } from "../lib/exact-plants.server";
import {
  FULFILLMENT_CHOICE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  formatLinkedInventory,
  inventoryHoldState,
  MIN_STOCK_SEARCH_TERM,
  unlinkableVariantReason,
  type FulfillmentType,
  type InventoryHoldState,
  type StoredFulfillmentType,
} from "../lib/growers-choice";
import {
  closeDeclinedRequest,
  createPaymentLinkForRequest,
} from "../lib/offer-response.server";
import { requestPlantPatterns } from "../lib/plant-behavior.server";
import {
  formatCurrency,
  formatDateTime,
  getDisplayRequestNumber,
  incompleteOfferItems,
  offerReadinessMessage,
  payableInvoiceUrl,
  requestStatusTone,
  UNAVAILABLE_REASON_OPTIONS,
  type ItemAvailabilityStatus,
  type OfferExpirationDays,
  type PlantItem,
  type PlantItemStatus,
  type RequestStatus,
  type SentOffer,
  type UnavailableReason,
} from "../lib/portal";
import {
  addItemPhotos,
  expireOverdueOffers,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  linkExistingStock,
  markRequestViewed,
  moveItemPhoto,
  removeItemPhoto,
  sendOffer,
  unlinkExistingStock,
  updateRequestItem,
} from "../lib/portal.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";
import {
  getExistingStockVariant,
  refreshFedexUpgradePrice,
  searchExistingStock,
  uploadPlantPhoto,
} from "../lib/shopify-ops.server";
import { saveLocalUpload } from "../lib/uploads.server";
import { voidExpiredDraftOrder } from "../lib/draft-order-void.server";

function itemStatusTone(
  status: PlantItemStatus,
): "info" | "warning" | "caution" | "success" | "critical" {
  switch (status) {
    case "Requested":
      return "info";
    case "Sourced":
      return "warning";
    case "Offered":
      return "caution";
    case "Sold":
      return "success";
    case "Listed":
      return "success";
    case "Unavailable":
      return "critical";
  }
}

const numberInputStyle = {
  width: "120px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
} as const;

const disabledNumberInputStyle = {
  ...numberInputStyle,
  background: "#f6f6f7",
  color: "#6d7175",
  border: "1px solid #e1e3e5",
} as const;

const textInputStyle = {
  width: "100%",
  maxWidth: "420px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
} as const;

const selectStyle = {
  ...textInputStyle,
  background: "#fff",
} as const;

const disabledTextareaStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #e1e3e5",
  font: "inherit",
  lineHeight: 1.5,
  resize: "vertical" as const,
  background: "#f6f6f7",
  color: "#6d7175",
};

const editableTextareaStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  lineHeight: 1.5,
  resize: "vertical" as const,
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const requestId = params.id ?? "";
  await expireOverdueOffers(shop);
  await voidExpiredDraftOrder(shop, requestId, admin);
  const plantRequest = await getRequest(shop, requestId);
  if (plantRequest) {
    await markRequestViewed(shop, requestId);
  }
  const response = plantRequest
    ? await getCustomerResponse(shop, requestId)
    : null;
  // Dates are formatted here because the outbox rows are rendered as text.
  const emails = plantRequest
    ? (await listEmailsForRequest(shop, requestId)).map((email) => ({
        ...email,
        createdAt: formatDateTime(email.createdAt),
        sentAt: email.sentAt ? formatDateTime(email.sentAt) : null,
      }))
    : [];
  const draftOrder = plantRequest ? await getDraftOrder(shop, requestId) : null;

  const declinedExactPlants = plantRequest
    ? await listExactPlantCandidates(shop, requestId)
    : [];

  // Internal insight for whoever is about to price this request. Never sent to
  // the customer and never a reason to refuse them anything.
  const plantPatterns = plantRequest
    ? (await requestPlantPatterns(shop, requestId)).map((pattern) => ({
        canonicalPlantId: pattern.activity.canonicalPlantId,
        summary: pattern.summary,
        timesRequested: pattern.activity.timesRequested,
        timesOffered: pattern.activity.timesOffered,
        timesDeclined: pattern.activity.timesDeclined,
        timesPurchased: pattern.activity.timesPurchased,
        rangeDays: pattern.activity.rangeDays,
        mostRecentRequestDate: formatDateTime(pattern.activity.mostRecentRequestAt),
        requestedNames: pattern.activity.requestedNames,
      }))
    : [];

  return {
    requestId,
    shop,
    plantRequest,
    response,
    emails,
    paymentLink: payableInvoiceUrl({
      invoiceUrl: draftOrder?.invoiceUrl,
      voidedAt: draftOrder?.voidedAt,
      requestClosed: plantRequest?.status === "Closed",
      requestPaid: Boolean(plantRequest?.paidAt),
      expiresAtIso: plantRequest?.sentOffer?.expiresAtIso,
    }),
    paymentAfterVoid: Boolean(
      plantRequest?.paidAt && (draftOrder?.voidedAt || plantRequest.expiredAt),
    ),
    invoiceVoided: Boolean(draftOrder?.voidedAt && !plantRequest?.paidAt),
    inventoryHold: draftOrder?.reserveInventoryUntil
      ? {
          state: inventoryHoldState({
            reserveInventoryUntil: draftOrder.reserveInventoryUntil,
            paidAt: plantRequest?.paidAt,
          }),
          until: formatDateTime(draftOrder.reserveInventoryUntil),
        }
      : null,
    declinedExactPlants,
    plantPatterns,
  };
};

/** A retry that did not deliver has to say why, or it looks like it worked. */
function undeliveredMessage(
  message?: { status: string; error: string | null } | null,
): string {
  if (message?.status === "preview") {
    // Nothing was attempted, so any error still on the row is from before.
    return "Not delivered: RESEND_API_KEY is not set for this deployment, so the message is stored but never sent.";
  }
  return message?.error
    ? `Still undelivered: ${message.error}`
    : "Still undelivered. Check that RESEND_API_KEY and EMAIL_FROM are set for this deployment.";
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  const requestId = params.id ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "search-stock") {
      const term = String(form.get("stockQuery") || "").trim();
      const results = await searchExistingStock(admin, shop, term);
      return {
        ok: true,
        stockSearch: {
          itemId: String(form.get("itemId") || ""),
          term,
          results: results.map((candidate) => ({
            ...candidate,
            unlinkableReason: unlinkableVariantReason(candidate),
          })),
        },
      };
    }

    if (intent === "link-stock") {
      const variantGid = String(form.get("variantGid") || "");
      // Re-read rather than trust the posted price and stock: this page may
      // have been open since before the plant sold.
      const variant = await getExistingStockVariant(admin, shop, variantGid);
      if (!variant) {
        return {
          ok: false,
          error: "That Shopify variant no longer exists. Search again.",
        };
      }
      const reason = unlinkableVariantReason(variant);
      if (reason) return { ok: false, error: reason };

      await linkExistingStock(shop, {
        requestId,
        itemId: String(form.get("itemId") || ""),
        variant,
      });
      return { ok: true };
    }

    if (intent === "unlink-stock") {
      await unlinkExistingStock(
        shop,
        requestId,
        String(form.get("itemId") || ""),
      );
      return { ok: true };
    }

    if (intent === "update-item") {
      await updateRequestItem(shop, {
        requestId,
        itemId: String(form.get("itemId") || ""),
        offeredName: form.has("offeredName")
          ? String(form.get("offeredName") || "")
          : undefined,
        availability: form.has("availability")
          ? (String(form.get("availability")) as ItemAvailabilityStatus)
          : undefined,
        fulfillmentType: form.has("fulfillmentType")
          ? (String(form.get("fulfillmentType")) as StoredFulfillmentType)
          : undefined,
        unavailableReason: form.has("unavailableReason")
          ? (String(form.get("unavailableReason")) as UnavailableReason)
          : undefined,
        price: form.has("price")
          ? Number.parseFloat(String(form.get("price")))
          : undefined,
        weightLbs: form.has("weightLbs")
          ? Number.parseFloat(String(form.get("weightLbs")))
          : undefined,
        customerFacingNotes: form.has("customerFacingNotes")
          ? String(form.get("customerFacingNotes") || "")
          : undefined,
      });
      return { ok: true };
    }

    if (intent === "add-photo-url") {
      const url = String(form.get("photoUrl") || "").trim();
      if (url) {
        await addItemPhotos(shop, requestId, String(form.get("itemId") || ""), [
          { url },
        ]);
      }
      return { ok: true };
    }

    if (intent === "remove-photo") {
      await removeItemPhoto(
        shop,
        requestId,
        String(form.get("itemId") || ""),
        String(form.get("photoId") || ""),
      );
      return { ok: true };
    }

    if (intent === "move-photo") {
      await moveItemPhoto(
        shop,
        requestId,
        String(form.get("itemId") || ""),
        String(form.get("photoId") || ""),
        String(form.get("direction")) === "up" ? "up" : "down",
      );
      return { ok: true };
    }

    if (intent === "upload-photo") {
      const itemId = String(form.get("itemId") || "");
      const upload = form.get("photo");
      if (upload instanceof File && upload.size > 0) {
        const data = Buffer.from(await upload.arrayBuffer());
        let stored: { url: string; shopifyFileId?: string };
        try {
          stored = await uploadPlantPhoto(admin, shop, {
            filename: upload.name,
            mimeType: upload.type || "image/jpeg",
            data,
          });
        } catch (error) {
          // Local disk is ephemeral on a hosted deploy and is not served by
          // the Shopify CDN, so a failed upload must surface rather than appear
          // to succeed with a URL that dies at the next deploy.
          if (!canStubShopifyWrites(shop)) {
            console.error(
              `Shopify Files upload failed for request ${requestId}.`,
              error,
            );
            throw new Error(
              `Could not upload ${upload.name} to Shopify Files: ${
                error instanceof Error ? error.message : "unknown error"
              }. The photo was not attached — please try again.`,
            );
          }
          stored = {
            url: await saveLocalUpload(shop, itemId, {
              filename: upload.name,
              data,
            }),
          };
        }
        await addItemPhotos(shop, requestId, itemId, [stored]);
      }
      return { ok: true };
    }

    if (intent === "send-offer") {
      const days = Number(form.get("expirationDays")) as OfferExpirationDays;
      const expirationDays: OfferExpirationDays =
        days === 5 || days === 7 ? days : 3;
      // The offer freezes the FedEx upgrade price into what the customer sees,
      // is emailed and is later billed, so read it from Shopify first.
      await refreshFedexUpgradePrice(admin, shop);
      const updated = await sendOffer(shop, requestId, expirationDays);
      if (updated) {
        const appUrl =
          process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
        await notifyOfferReady(shop, requestId, appUrl);
      }
      return { ok: true, sent: Boolean(updated) };
    }

    // `sendOffer` commits the offer and moves the request out of New, so it
    // refuses to run a second time. Without this, an offer-ready email that
    // failed after that commit could never be sent at all.
    if (intent === "resend-offer-email") {
      const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
      const message = await notifyOfferReady(shop, requestId, appUrl);
      if (message?.status === "sent") return { ok: true };
      return { ok: false, error: undeliveredMessage(message) };
    }

    if (intent === "retry-email") {
      const message = await redeliverEmailMessage(
        shop,
        String(form.get("emailId") || ""),
      );
      if (!message) {
        return { ok: false, error: "That email is no longer in the outbox." };
      }
      if (message.status === "sent") return { ok: true };
      return { ok: false, error: undeliveredMessage(message) };
    }

    if (intent === "create-payment-link") {
      const result = await createPaymentLinkForRequest({
        shop,
        requestId,
        admin,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true };
    }

    if (intent === "close-request") {
      const result = await closeDeclinedRequest({ shop, requestId });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }

  return { ok: false, error: "Unknown action" };
};

const FULFILLMENT_CHOICES: FulfillmentType[] = [
  "exact_plant",
  "growers_choice",
  "not_available",
];

/**
 * The store listing behind a Grower's Choice item: search, link, change, unlink.
 *
 * Every one of these is refused server-side once the offer is sent, and the
 * panel disappears with it — the offer snapshot is what the customer answered
 * and is billed against.
 */
function ExistingStockPanel({
  item,
  shop,
  canEdit,
}: {
  item: PlantItem;
  shop: string;
  canEdit: boolean;
}) {
  const searchFetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
  const [term, setTerm] = useState("");

  const searchData = searchFetcher.data;
  const search =
    searchData && "stockSearch" in searchData && searchData.stockSearch
      ? searchData.stockSearch
      : null;
  const results = search?.itemId === item.id ? search.results : [];
  const linkError =
    linkFetcher.data && !linkFetcher.data.ok ? linkFetcher.data.error : null;
  const linked = item.linkedStock;
  const productAdminUrl = linked
    ? shopifyAdminProductUrl(shop, linked.productGid)
    : undefined;

  return (
    <s-stack direction="block" gap="base">
      {linked ? (
        <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Linked website stock</s-text>
            <s-stack direction="inline" gap="base">
              {linked.imageUrl ? (
                <img
                  src={linked.imageUrl}
                  alt={linked.productTitle}
                  width={80}
                  height={80}
                  style={{ display: "block", objectFit: "cover", borderRadius: "8px" }}
                />
              ) : null}
              <s-stack direction="block" gap="small">
                <s-text>
                  <strong>{linked.productTitle}</strong>
                  {linked.variantTitle ? ` — ${linked.variantTitle}` : ""}
                </s-text>
                <s-text color="subdued">
                  {[
                    linked.sku ? `SKU ${linked.sku}` : null,
                    linked.variantPrice !== undefined
                      ? `${formatCurrency(linked.variantPrice)} in Shopify`
                      : null,
                    formatLinkedInventory(linked),
                    linked.variantWeightLbs
                      ? `${linked.variantWeightLbs} lb`
                      : "no weight in Shopify",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </s-text>
                {productAdminUrl ? (
                  <s-link href={productAdminUrl} target="_blank">
                    Open in Shopify admin
                  </s-link>
                ) : null}
              </s-stack>
            </s-stack>
            {canEdit ? (
              <linkFetcher.Form method="post">
                <input type="hidden" name="intent" value="unlink-stock" />
                <input type="hidden" name="itemId" value={item.id} />
                <s-button variant="secondary" tone="critical" type="submit">
                  Unlink
                </s-button>
              </linkFetcher.Form>
            ) : null}
          </s-stack>
        </s-box>
      ) : (
        <s-text color="subdued">
          No website stock is linked yet, so this offer cannot be sent.
        </s-text>
      )}

      {canEdit ? (
        <s-stack direction="block" gap="small">
          <label htmlFor={`stock-search-${item.id}`}>
            <s-text color="subdued">
              {linked ? "Change the linked listing" : "Search existing website stock"}
            </s-text>
          </label>
          <s-stack direction="inline" gap="small">
            <input
              id={`stock-search-${item.id}`}
              value={term}
              placeholder="Product title, variant, or SKU"
              onChange={(event) => setTerm(event.currentTarget.value)}
              style={textInputStyle}
            />
            <s-button
              variant="secondary"
              onClick={() => {
                const data = new FormData();
                data.set("intent", "search-stock");
                data.set("itemId", item.id);
                data.set("stockQuery", term);
                searchFetcher.submit(data, { method: "post" });
              }}
              {...(term.trim().length < MIN_STOCK_SEARCH_TERM
                ? { disabled: true }
                : {})}
            >
              Search Shopify
            </s-button>
          </s-stack>

          {linkError ? (
            <s-banner tone="critical">
              <s-text>{linkError}</s-text>
            </s-banner>
          ) : null}

          {search && results.length === 0 ? (
            <s-text color="subdued">
              No Shopify products match “{search.term}”.
            </s-text>
          ) : null}

          {results.map((candidate) => (
            <s-box
              key={candidate.variantGid}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="base"
            >
              <s-stack direction="inline" gap="base">
                {candidate.imageUrl ? (
                  <img
                    src={candidate.imageUrl}
                    alt={candidate.productTitle}
                    width={64}
                    height={64}
                    style={{ display: "block", objectFit: "cover", borderRadius: "8px" }}
                  />
                ) : null}
                <s-stack direction="block" gap="small">
                  <s-text>
                    <strong>{candidate.productTitle}</strong>
                    {candidate.variantTitle ? ` — ${candidate.variantTitle}` : ""}
                  </s-text>
                  <s-text color="subdued">
                    {[
                      candidate.sku ? `SKU ${candidate.sku}` : null,
                      formatCurrency(candidate.price),
                      formatLinkedInventory(candidate),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </s-text>
                  {/*
                    Shown rather than hidden: "out of stock" and "no such plant"
                    send whoever is sourcing this to completely different places.
                  */}
                  {candidate.unlinkableReason ? (
                    <s-text color="subdued">{candidate.unlinkableReason}</s-text>
                  ) : (
                    <linkFetcher.Form method="post">
                      <input type="hidden" name="intent" value="link-stock" />
                      <input type="hidden" name="itemId" value={item.id} />
                      <input
                        type="hidden"
                        name="variantGid"
                        value={candidate.variantGid}
                      />
                      <s-button variant="secondary" type="submit">
                        Link this variant
                      </s-button>
                    </linkFetcher.Form>
                  )}
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      ) : null}
    </s-stack>
  );
}

function PlantItemCard({
  item,
  shop,
  canEdit,
}: {
  item: PlantItem;
  shop: string;
  canEdit: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const photoFetcher = useFetcher<typeof action>();
  const [offeredName, setOfferedName] = useState(item.offeredName);
  const [customerNotes, setCustomerNotes] = useState(item.customerFacingNotes);
  const [fulfillment, setFulfillment] = useState<FulfillmentType>(
    item.fulfillmentType,
  );
  const [unavailableReason, setUnavailableReason] = useState(
    item.unavailableReason,
  );
  const [price, setPrice] = useState(item.price);
  const [weightLbs, setWeightLbs] = useState(item.weightLbs);
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    setOfferedName(item.offeredName);
    setCustomerNotes(item.customerFacingNotes);
    setFulfillment(item.fulfillmentType);
    setUnavailableReason(item.unavailableReason);
    setPrice(item.price);
    setWeightLbs(item.weightLbs);
  }, [item]);

  const isAvailable = fulfillment !== "not_available";
  const growersChoice = fulfillment === "growers_choice";
  const fieldsLocked = !canEdit;

  const saveField = (fields: Record<string, string>) => {
    if (fieldsLocked) return;
    const data = new FormData();
    data.set("intent", "update-item");
    data.set("itemId", item.id);
    for (const [key, value] of Object.entries(fields)) {
      data.set(key, value);
    }
    fetcher.submit(data, { method: "post" });
  };

  const handleFulfillmentChange = (next: FulfillmentType) => {
    setFulfillment(next);
    // Not Available lives in availability, which every rule downstream already
    // reads; the other two are the stored route with the item still available.
    saveField(
      next === "not_available"
        ? { availability: "not_available" }
        : { availability: "available", fulfillmentType: next },
    );
  };

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          <s-heading>{item.plantName}</s-heading>
          <s-badge tone={itemStatusTone(item.itemStatus)}>
            {item.itemStatus}
          </s-badge>
          <s-badge tone={isAvailable ? "success" : "critical"}>
            {FULFILLMENT_TYPE_LABELS[fulfillment]}
          </s-badge>
        </s-stack>

        {item.fulfillmentIssue ? (
          <s-banner tone="critical">
            <s-text>{item.fulfillmentIssue}</s-text>
          </s-banner>
        ) : null}

        {item.adminNotes ? (
          <s-text color="subdued">Customer request notes: {item.adminNotes}</s-text>
        ) : null}

        <s-stack direction="block" gap="small">
          <s-text color="subdued">How this plant will be supplied</s-text>
          <s-stack direction="inline" gap="small">
            {FULFILLMENT_CHOICES.map((choice) => (
              <s-button
                key={choice}
                variant={fulfillment === choice ? "primary" : "secondary"}
                onClick={() => handleFulfillmentChange(choice)}
                {...(fieldsLocked ? { disabled: true } : {})}
              >
                {FULFILLMENT_CHOICE_LABELS[choice]}
              </s-button>
            ))}
          </s-stack>
        </s-stack>

        {growersChoice ? (
          <ExistingStockPanel item={item} shop={shop} canEdit={canEdit} />
        ) : null}

        {!isAvailable && (
          <s-stack direction="block" gap="small">
            <label htmlFor={`unavailable-reason-${item.id}`}>
              <s-text color="subdued">Unavailable Reason</s-text>
            </label>
            <select
              id={`unavailable-reason-${item.id}`}
              value={unavailableReason}
              disabled={fieldsLocked}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const reason = event.currentTarget.value as UnavailableReason;
                setUnavailableReason(reason);
                saveField({ unavailableReason: reason });
              }}
              style={selectStyle}
            >
              {UNAVAILABLE_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </s-stack>
        )}

        {isAvailable && (
          <>
            <s-stack direction="block" gap="small">
              <label htmlFor={`offered-name-${item.id}`}>
                <s-text color="subdued">Final item name</s-text>
              </label>
              <input
                id={`offered-name-${item.id}`}
                value={offeredName}
                readOnly={fieldsLocked}
                disabled={fieldsLocked}
                onChange={(event) => setOfferedName(event.currentTarget.value)}
                onBlur={() => saveField({ offeredName })}
                style={fieldsLocked ? disabledNumberInputStyle : textInputStyle}
              />
            </s-stack>

            <s-stack direction="inline" gap="large">
              <s-stack direction="block" gap="small">
                <label htmlFor={`price-${item.id}`}>
                  <s-text color="subdued">Price</s-text>
                </label>
                <input
                  id={`price-${item.id}`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={price}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onChange={(event) =>
                    setPrice(Number.parseFloat(event.currentTarget.value) || 0)
                  }
                  onBlur={() => saveField({ price: String(price) })}
                  style={fieldsLocked ? disabledNumberInputStyle : numberInputStyle}
                />
              </s-stack>
              <s-stack direction="block" gap="small">
                <label htmlFor={`weight-${item.id}`}>
                  <s-text color="subdued">
                    {growersChoice
                      ? "Weight in lbs (used only if Shopify has none)"
                      : "Weight in lbs (internal only)"}
                  </s-text>
                </label>
                <input
                  id={`weight-${item.id}`}
                  type="number"
                  min={0}
                  step={0.1}
                  value={weightLbs}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onChange={(event) =>
                    setWeightLbs(
                      Number.parseFloat(event.currentTarget.value) || 0,
                    )
                  }
                  onBlur={() => saveField({ weightLbs: String(weightLbs) })}
                  style={fieldsLocked ? disabledNumberInputStyle : numberInputStyle}
                />
              </s-stack>
            </s-stack>

            {/*
              A Grower's Choice customer is not being sold the plant in the
              photo, so the offer carries the store listing's image instead and
              photographing an individual would be a promise nobody can keep.
            */}
            {growersChoice ? null : (
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Exact plant photos</s-text>
              <s-stack direction="inline" gap="base">
                {(canEdit && item.photos.length > 0
                  ? item.photos
                  : item.photoUrls.map((url) => ({ id: url, url }))
                ).map((photo, index, all) => (
                  <s-stack key={photo.id} direction="block" gap="small">
                    <img
                      src={photo.url}
                      alt={item.offeredName || item.plantName}
                      width={120}
                      height={120}
                      style={{
                        display: "block",
                        objectFit: "cover",
                        borderRadius: "8px",
                      }}
                    />
                    {index === 0 ? (
                      <s-badge tone="info">Customer sees first</s-badge>
                    ) : null}
                    {canEdit && item.photos.length > 0 ? (
                      <s-stack direction="inline" gap="small">
                        <photoFetcher.Form method="post">
                          <input type="hidden" name="intent" value="move-photo" />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="photoId" value={photo.id} />
                          <input type="hidden" name="direction" value="up" />
                          <s-button
                            variant="secondary"
                            type="submit"
                            {...(index === 0 ? { disabled: true } : {})}
                          >
                            Move left
                          </s-button>
                        </photoFetcher.Form>
                        <photoFetcher.Form method="post">
                          <input type="hidden" name="intent" value="move-photo" />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="photoId" value={photo.id} />
                          <input type="hidden" name="direction" value="down" />
                          <s-button
                            variant="secondary"
                            type="submit"
                            {...(index === all.length - 1 ? { disabled: true } : {})}
                          >
                            Move right
                          </s-button>
                        </photoFetcher.Form>
                        <photoFetcher.Form method="post">
                          <input type="hidden" name="intent" value="remove-photo" />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="photoId" value={photo.id} />
                          <s-button variant="secondary" tone="critical" type="submit">
                            Remove
                          </s-button>
                        </photoFetcher.Form>
                      </s-stack>
                    ) : null}
                  </s-stack>
                ))}
              </s-stack>
              {canEdit ? (
                <s-stack direction="block" gap="small">
                  <photoFetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="upload-photo" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="file" name="photo" accept="image/*" />
                    <s-button variant="secondary" type="submit">
                      Upload plant photo
                    </s-button>
                  </photoFetcher.Form>
                  <photoFetcher.Form method="post">
                    <input type="hidden" name="intent" value="add-photo-url" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <s-stack direction="inline" gap="small">
                      <input
                        name="photoUrl"
                        value={photoUrl}
                        placeholder="https://..."
                        onChange={(event) => setPhotoUrl(event.currentTarget.value)}
                        style={textInputStyle}
                      />
                      <s-button variant="secondary" type="submit">
                        Add photo URL
                      </s-button>
                    </s-stack>
                  </photoFetcher.Form>
                </s-stack>
              ) : null}
            </s-stack>
            )}
          </>
        )}

        <s-stack direction="block" gap="small">
          <label htmlFor={`customer-notes-${item.id}`}>
            <s-text color="subdued">Customer Notes / Disclaimers</s-text>
          </label>
          <textarea
            id={`customer-notes-${item.id}`}
            rows={3}
            value={customerNotes}
            readOnly={fieldsLocked}
            disabled={fieldsLocked}
            placeholder="e.g. Minor cosmetic damage on one leaf."
            onChange={(event) => setCustomerNotes(event.currentTarget.value)}
            onBlur={() => saveField({ customerFacingNotes: customerNotes })}
            style={fieldsLocked ? disabledTextareaStyle : editableTextareaStyle}
          />
          <s-text color="subdued">
            {fieldsLocked
              ? "Read-only. Notes, photos, and prices are frozen after the offer is sent so the customer sees the exact snapshot."
              : "Shown to the customer on the offer page, approval snapshot, confirmation email, and final approval summary."}
          </s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

type OutboxMessage = Awaited<ReturnType<typeof loader>>["emails"][number];

const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  request_received: "Request received",
  admin_new_request: "New request (admin)",
  admin_response: "Customer responded (admin)",
  offer_ready: "Offer ready",
  confirmation: "Response summary",
  checkout_link: "Payment link",
  expiration_reminder: "Expiration reminder",
  compliance_data_request: "Customer data request",
};

function emailStatusTone(
  status: string,
): "success" | "warning" | "critical" | "info" {
  switch (status) {
    case "sent":
      return "success";
    case "failed":
      return "critical";
    case "preview":
      return "warning";
    default:
      return "info";
  }
}

/**
 * The outbox for this request. A failed message used to exist only as one line
 * in the hosting provider's log, so nobody found out until a customer asked why
 * they had heard nothing.
 */
function EmailSection({ emails }: { emails: OutboxMessage[] }) {
  const undelivered = emails.filter((email) => email.status !== "sent");

  return (
    <s-section heading="Emails">
      <s-stack direction="block" gap="base">
        {undelivered.length > 0 ? (
          <s-banner tone="critical">
            <s-text>
              {undelivered.length === 1
                ? "1 email for this request has not been delivered."
                : `${undelivered.length} emails for this request have not been delivered.`}{" "}
              Retry each one below once the cause is fixed. The hourly maintenance
              run also retries them.
            </s-text>
          </s-banner>
        ) : null}

        {emails.length === 0 ? (
          <s-text color="subdued">
            No emails have been queued for this request yet.
          </s-text>
        ) : (
          emails.map((email) => (
            <s-box
              key={email.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base">
                  <s-text>
                    <strong>
                      {EMAIL_TEMPLATE_LABELS[email.templateKey] ?? email.templateKey}
                    </strong>
                  </s-text>
                  <s-badge tone={emailStatusTone(email.status)}>
                    {email.status}
                  </s-badge>
                </s-stack>
                <s-text color="subdued">To {email.toEmail}</s-text>
                <s-text color="subdued">
                  {email.sentAt
                    ? `Sent ${email.sentAt}`
                    : `Queued ${email.createdAt} · ${email.attempts} delivery attempt(s)`}
                </s-text>
                {email.error ? (
                  <s-banner tone="critical">
                    <s-text>{email.error}</s-text>
                  </s-banner>
                ) : null}
                {email.status === "sent" ? null : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="retry-email" />
                    <input type="hidden" name="emailId" value={email.id} />
                    <s-button variant="secondary" type="submit">
                      Retry delivery
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-box>
          ))
        )}
      </s-stack>
    </s-section>
  );
}

const EXPIRATION_OPTIONS: { days: OfferExpirationDays; label: string }[] = [
  { days: 3, label: "3 days" },
  { days: 5, label: "5 days" },
  { days: 7, label: "7 days" },
];

function SendOfferSection({
  status,
  sentOffer,
  offerEmail,
  items,
}: {
  status: RequestStatus;
  sentOffer?: SentOffer;
  /** The outbox row, which is the only evidence the customer was told. */
  offerEmail?: OutboxMessage;
  items: PlantItem[];
}) {
  const [expirationDays, setExpirationDays] = useState<OfferExpirationDays>(3);
  const navigation = useNavigation();
  const sending =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "send-offer";

  if (sentOffer) {
    const delivered = offerEmail?.status === "sent";
    return (
      <s-stack direction="block" gap="base">
        {delivered ? (
          <s-banner tone="success">
            <s-text>Offer sent to customer</s-text>
          </s-banner>
        ) : (
          /*
           * The offer is committed and the request is no longer New, so the
           * banner used to claim the customer had been told whether or not the
           * email ever left the building.
           */
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">
              <s-text>
                The offer is live but the offer-ready email has not reached the
                customer. They have no idea it is waiting, and the hold is
                already running. The Emails section below has the reason.
              </s-text>
            </s-banner>
            <Form method="post">
              <input type="hidden" name="intent" value="resend-offer-email" />
              <s-button variant="primary" type="submit">
                Send the offer email again
              </s-button>
            </Form>
          </s-stack>
        )}
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Offer link</s-text>
              <s-link href={sentOffer.offerLink}>{sentOffer.offerLink}</s-link>
            </s-stack>
            <s-stack direction="inline" gap="large">
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Offer sent</s-text>
                <s-text>{sentOffer.sentAt}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Expires</s-text>
                <s-text>{sentOffer.expiresAt}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Expiration window</s-text>
                <s-text>{sentOffer.expirationDays} days</s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-box>
      </s-stack>
    );
  }

  if (status !== "New") {
    return (
      <s-text color="subdued">
        Offers can only be sent while the request status is New.
      </s-text>
    );
  }

  // `sendOffer` refuses the same submission, but a merchant should find out
  // before they press the button and freeze the snapshot.
  const problems = incompleteOfferItems(items);

  return (
    <Form method="post">
      <s-stack direction="block" gap="base">
        <input type="hidden" name="intent" value="send-offer" />
        <input type="hidden" name="expirationDays" value={expirationDays} />
        {problems.length > 0 ? (
          <s-banner tone="critical">
            <s-stack direction="block" gap="small">
              <s-text>{offerReadinessMessage(problems)}</s-text>
              <s-text color="subdued">
                Customer-facing notes are optional. A Grower&rsquo;s Choice item
                needs a linked listing with enough stock instead of an exact
                photo. Not Available items need none of these.
              </s-text>
            </s-stack>
          </s-banner>
        ) : null}
        <s-paragraph>
          Choose how long the customer has to review and accept this offer.
        </s-paragraph>
        <s-stack direction="inline" gap="small">
          {EXPIRATION_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => setExpirationDays(option.days)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #c9cccf",
                background: expirationDays === option.days ? "#008060" : "#fff",
                color: expirationDays === option.days ? "#fff" : "inherit",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
        </s-stack>
        <s-button
          variant="primary"
          type="submit"
          {...(sending ? { loading: true } : {})}
          {...(problems.length > 0 ? { disabled: true } : {})}
        >
          Send Offer
        </s-button>
      </s-stack>
    </Form>
  );
}

function DeclinedExactPlantsSection({
  requestId,
  items,
}: {
  requestId: string;
  items: Awaited<ReturnType<typeof listExactPlantCandidates>>;
}) {
  const returnTo = `/app/requests/${requestId}`;
  return (
    <s-section heading="Declined exact plants">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          These plants were marked Available, offered as exact plants, and
          rejected by the customer. Review a listing before any Shopify product
          is created. Not Available items are not included, and neither are
          Grower&rsquo;s Choice items — those already have a Shopify product.
        </s-text>
        {items.length === 0 ? (
          <s-text color="subdued">No declined exact plants on this request.</s-text>
        ) : (
          items.map((item) => {
            const listed =
              item.listing?.status === "listed" && item.listing.shopifyProductGid;
            return (
              <s-box
                key={item.requestItemId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{item.title}</s-heading>
                  <s-text>
                    {formatCurrency(item.price)} · {item.weightLbs} lb
                  </s-text>
                  {item.listing?.status === "failed" && item.listing.lastError ? (
                    <s-banner tone="critical">
                      <s-text>{item.listing.lastError}</s-text>
                    </s-banner>
                  ) : null}
                  {listed ? (
                    <s-stack direction="inline" gap="base">
                      <s-badge tone="success">Listed in EXACT PLANTS</s-badge>
                      {item.listing?.productAdminUrl ? (
                        <s-link href={item.listing.productAdminUrl} target="_blank">
                          Open Shopify product
                        </s-link>
                      ) : null}
                    </s-stack>
                  ) : (
                    <s-link
                      href={`/app/exact-plants/${item.requestItemId}?returnTo=${encodeURIComponent(returnTo)}`}
                    >
                      Create EXACT PLANTS Listing
                    </s-link>
                  )}
                </s-stack>
              </s-box>
            );
          })
        )}
      </s-stack>
    </s-section>
  );
}

/**
 * A draft order is only ever created from the customer's own submission, and
 * re-submitting an answered offer is refused, so a Shopify failure at that
 * moment left an accepted request with no way to pay. This is the way back.
 */
function PaymentLinkSection({ paymentLink }: { paymentLink: string | null }) {
  if (paymentLink) {
    return (
      <s-stack direction="block" gap="small">
        <s-text color="subdued">Payment link</s-text>
        <s-link href={paymentLink}>{paymentLink}</s-link>
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-banner tone="critical">
        <s-text>
          This customer accepted plants but no Shopify draft order exists, so
          they have no way to pay. Create the payment link and email it to them.
        </s-text>
      </s-banner>
      <Form method="post">
        <input type="hidden" name="intent" value="create-payment-link" />
        <s-button variant="primary" type="submit">
          Create payment link and email it
        </s-button>
      </Form>
    </s-stack>
  );
}

/**
 * Ends a request whose customer accepted nothing.
 *
 * Closing it also takes its declined plants out of the EXACT PLANTS review
 * queue — `exactPlantReleaseReason` never releases a plant on a Closed request
 * — so the merchant is told that before they press it rather than after they
 * go looking for the listing.
 */
function CloseRequestSection() {
  return (
    <s-stack direction="block" gap="base">
      <s-text color="subdued">
        The customer declined every item, so nothing is owed and no draft order
        exists. Closing the request records that it is finished. The declined
        plants stay in the EXACT PLANTS review queue.
      </s-text>
      <Form method="post">
        <input type="hidden" name="intent" value="close-request" />
        <s-button variant="primary" type="submit">
          Close Request
        </s-button>
      </Form>
    </s-stack>
  );
}

type InventoryHold = { state: InventoryHoldState; until: string };

/**
 * Whether Shopify is still holding the linked stock behind an accepted plant.
 *
 * Shopify does the holding and the releasing on its own clock, so the merchant
 * has no way to tell from the portal whether a plant they can see on the
 * request is spoken for or back on open sale.
 */
function InventoryHoldNotice({ hold }: { hold: InventoryHold }) {
  if (hold.state === "purchased") {
    return (
      <s-text color="subdued">
        The customer paid, so Shopify has taken the linked website stock off the
        listing as an ordinary sale.
      </s-text>
    );
  }
  if (hold.state === "held") {
    return (
      <s-text color="subdued">
        Shopify is holding the linked website stock until {hold.until}, when the
        payment deadline runs out and the plant goes back on sale.
      </s-text>
    );
  }
  return (
    <s-banner tone="warning">
      <s-text>
        The hold on the linked website stock ended at {hold.until} without
        payment, so the plant is back on open sale and another customer could buy
        it. Check the listing before chasing this payment.
      </s-text>
    </s-banner>
  );
}

function CustomerResponseSection({
  response,
  status,
  paymentLink,
  inventoryHold,
}: {
  response: Awaited<ReturnType<typeof getCustomerResponse>>;
  status: RequestStatus;
  paymentLink: string | null;
  inventoryHold: InventoryHold | null;
}) {
  if (!response) {
    return (
      <s-section heading="Customer response">
        <s-text color="subdued">
          No customer response has been submitted for this request yet.
        </s-text>
      </s-section>
    );
  }

  const accepted = response.items.filter((item) => item.choice === "accept");
  const rejected = response.items.filter((item) => item.choice === "reject");

  return (
    <s-section heading="Customer response">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer response timestamp</s-text>
            <s-text>{response.respondedAt}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">FedEx upgrade</s-text>
            <s-text>
              {response.hasAcceptedPurchasableItems && response.fedexUpgradeSelected
                ? `Selected (${formatCurrency(response.fedexUpgradePrice)})`
                : response.hasAcceptedPurchasableItems
                  ? "Removed"
                  : "Not applicable"}
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Current request status</s-text>
            <s-badge tone={requestStatusTone(status)}>{status}</s-badge>
          </s-stack>
        </s-stack>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Accepted Items</s-heading>
            {accepted.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              accepted.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName} — {formatCurrency(item.price)}
                  {item.fulfillmentType === "growers_choice"
                    ? ` (${FULFILLMENT_TYPE_LABELS.growers_choice}: ${
                        item.linkedProductTitle ?? "linked website stock"
                      })`
                    : ""}
                </s-text>
              ))
            )}
            {accepted.length > 0 && inventoryHold ? (
              <InventoryHoldNotice hold={inventoryHold} />
            ) : null}
            {accepted.length > 0 ? (
              <PaymentLinkSection paymentLink={paymentLink} />
            ) : null}
          </s-stack>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Rejected Items</s-heading>
            {rejected.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              rejected.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName} — {formatCurrency(item.price)}
                </s-text>
              ))
            )}
          </s-stack>
        </s-box>

        {accepted.length === 0 && status !== "Closed" ? (
          <CloseRequestSection />
        ) : null}
      </s-stack>
    </s-section>
  );
}

/**
 * Internal only. This never reaches the customer, never blocks their request and
 * never changes what they are offered — it is here so whoever is about to source
 * and price this plant knows the customer has turned it down before.
 */
function PlantPatternSection({
  patterns,
}: {
  patterns: Awaited<ReturnType<typeof loader>>["plantPatterns"];
}) {
  if (patterns.length === 0) return null;

  return (
    <s-section heading="Internal insight">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Admin only. Not shown to the customer anywhere, and not a reason to
          refuse or change this request.
        </s-text>
        {patterns.map((pattern) => (
          <s-box
            key={pattern.canonicalPlantId}
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small">
              <s-badge tone="warning">Repeated Request / Decline Pattern</s-badge>
              <s-text>{pattern.summary}</s-text>
              <s-text color="subdued">
                Requested {pattern.timesRequested} · offered {pattern.timesOffered}{" "}
                · declined {pattern.timesDeclined} · purchased{" "}
                {pattern.timesPurchased} · over {pattern.rangeDays} days · most
                recent {pattern.mostRecentRequestDate}
              </s-text>
              <s-text color="subdued">
                Typed as: {pattern.requestedNames.join(", ")}
              </s-text>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}

export default function RequestDetail() {
  const {
    shop,
    plantRequest,
    response,
    emails,
    paymentLink,
    paymentAfterVoid,
    invoiceVoided,
    inventoryHold,
    declinedExactPlants,
    plantPatterns,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  // The action already returned these; without this the page silently ignored a
  // failed photo upload and looked as though nothing had happened.
  const actionError = actionData && !actionData.ok ? actionData.error : null;

  useEffect(() => {
    const onFocus = () => revalidator.revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidator]);

  if (!plantRequest) {
    return (
      <s-page heading="Request not found">
        <s-link slot="breadcrumb-actions" href="/app">
          Dashboard
        </s-link>
        <s-section>
          <s-text>This request could not be loaded.</s-text>
        </s-section>
      </s-page>
    );
  }

  const canEditItems = plantRequest.status === "New";

  return (
    <s-page heading={`Request ${getDisplayRequestNumber(plantRequest)}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      {actionError ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionError}</s-text>
          </s-banner>
        </s-section>
      ) : null}

      {paymentAfterVoid ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>
              Payment After Expiration/Void — Shopify recorded a payment on an
              invoice this portal had already made non-payable. The money is
              booked and the request is Closed, but a human must check whether
              the same plant was already relisted or sold.
            </s-text>
          </s-banner>
        </s-section>
      ) : null}

      {invoiceVoided ? (
        <s-section>
          <s-banner tone="warning">
            <s-text>
              The Shopify invoice for this expired offer was deleted so it can
              no longer be paid. The draft order reference, line items and
              offer snapshot are kept here.
            </s-text>
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Request summary">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer</s-text>
            <s-text>{plantRequest.customer}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Email</s-text>
            <s-text>{plantRequest.email}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={requestStatusTone(plantRequest.status)}>
              {plantRequest.status}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Submitted</s-text>
            <s-text>{plantRequest.submittedDate}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <PlantPatternSection patterns={plantPatterns} />

      <s-section heading="Plant items">
        {!canEditItems && (
          <s-banner tone="info">
            <s-text>
              This request is read-only because its status is {plantRequest.status}.
              Customer-facing notes, photos, names, and prices are frozen in the
              offer snapshot.
            </s-text>
          </s-banner>
        )}
        <s-stack direction="block" gap="base">
          {plantRequest.items.map((item) => (
            <PlantItemCard
              key={item.id}
              item={item}
              shop={shop}
              canEdit={canEditItems}
            />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Send Offer">
        <SendOfferSection
          status={plantRequest.status}
          sentOffer={plantRequest.sentOffer}
          offerEmail={emails.find((email) => email.templateKey === "offer_ready")}
          items={plantRequest.items}
        />
      </s-section>

      <CustomerResponseSection
        response={response}
        status={plantRequest.status}
        paymentLink={paymentLink}
        inventoryHold={inventoryHold}
      />

      <EmailSection emails={emails} />

      <DeclinedExactPlantsSection
        requestId={plantRequest.id}
        items={declinedExactPlants}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
