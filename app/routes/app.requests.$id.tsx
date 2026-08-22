import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
  adminOverrideCloseRequest,
  closeDeclinedRequest,
  createPaymentLinkForRequest,
} from "../lib/offer-response.server";
import { requestPlantPatterns } from "../lib/plant-behavior.server";
import {
  ADMIN_OVERRIDE_CLOSE_REASON,
  adminDraftOrderLinkState,
  formatCurrency,
  formatDateTime,
  getDisplayRequestNumber,
  incompleteOfferItems,
  offerReadinessMessage,
  payableInvoiceUrl,
  requestStatusTone,
  shouldOfferAdminPaymentLinkRecovery,
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
  requestHasEventReason,
  linkExistingStock,
  markRequestViewed,
  moveItemPhoto,
  removeItemPhoto,
  reorderItemPhotos,
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
import {
  mergeAdminItemDraft,
  type AdminItemDirty,
  type AdminItemDraft,
} from "../lib/admin-item-draft";
import { PhotoReorderStrip } from "../components/photo-reorder";
import { ReplaceZeroNumberInput } from "../components/replace-zero-number-input";
import { wrapRowStyle } from "../components/admin-layout";

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
  width: "100%",
  maxWidth: "160px",
  minWidth: "120px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  boxSizing: "border-box" as const,
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
    adminOverrideClosed: plantRequest
      ? await requestHasEventReason(
          shop,
          requestId,
          ADMIN_OVERRIDE_CLOSE_REASON,
        )
      : false,
    draftOrderAdmin: draftOrder
      ? {
          shopifyDraftOrderGid: draftOrder.shopifyDraftOrderGid,
          voidedAt: draftOrder.voidedAt
            ? formatDateTime(draftOrder.voidedAt)
            : null,
        }
      : null,
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

    if (intent === "reorder-photos") {
      const orderedIds = String(form.get("photoIds") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      await reorderItemPhotos(
        shop,
        requestId,
        String(form.get("itemId") || ""),
        orderedIds,
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

    if (intent === "admin-override-close") {
      const result = await adminOverrideCloseRequest({
        shop,
        requestId,
        admin,
        confirmed: String(form.get("confirmed")) === "true",
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          pendingAdminOverrideClose: Boolean(result.pendingAdminOverrideClose),
        };
      }
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
          <div style={wrapRowStyle}>
            <input
              id={`stock-search-${item.id}`}
              value={term}
              placeholder="Product title, variant, or SKU"
              onChange={(event) => setTerm(event.currentTarget.value)}
              style={{ ...textInputStyle, flex: "1 1 200px", minWidth: 0, maxWidth: "100%" }}
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
          </div>

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
  const serverDraft = (source: PlantItem): AdminItemDraft => ({
    offeredName: source.offeredName,
    customerFacingNotes: source.customerFacingNotes,
    fulfillmentType: source.fulfillmentType,
    unavailableReason: source.unavailableReason,
    price: source.price,
    weightLbs: source.weightLbs,
  });
  const dirtyRef = useRef<AdminItemDirty>({});
  const [draft, setDraft] = useState<AdminItemDraft>(() => serverDraft(item));
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    setDraft((local) => mergeAdminItemDraft(local, serverDraft(item), dirtyRef.current));
  }, [item]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok) {
      dirtyRef.current = {};
    }
  }, [fetcher.state, fetcher.data]);

  const offeredName = draft.offeredName;
  const customerNotes = draft.customerFacingNotes;
  const fulfillment = draft.fulfillmentType;
  const unavailableReason = draft.unavailableReason;
  const price = draft.price;
  const weightLbs = draft.weightLbs;

  const setOfferedName = (value: string) => {
    dirtyRef.current.offeredName = true;
    setDraft((current) => ({ ...current, offeredName: value }));
  };
  const setCustomerNotes = (value: string) => {
    dirtyRef.current.customerFacingNotes = true;
    setDraft((current) => ({ ...current, customerFacingNotes: value }));
  };
  const setFulfillment = (value: FulfillmentType) => {
    dirtyRef.current.fulfillmentType = true;
    setDraft((current) => ({ ...current, fulfillmentType: value }));
  };
  const setUnavailableReason = (value: UnavailableReason) => {
    dirtyRef.current.unavailableReason = true;
    setDraft((current) => ({ ...current, unavailableReason: value }));
  };
  const setPrice = (value: number) => {
    dirtyRef.current.price = true;
    setDraft((current) => ({ ...current, price: value }));
  };
  const setWeightLbs = (value: number) => {
    dirtyRef.current.weightLbs = true;
    setDraft((current) => ({ ...current, weightLbs: value }));
  };

  const isAvailable = fulfillment !== "not_available";
  const growersChoice = fulfillment === "growers_choice";
  const fieldsLocked = !canEdit;

  const saveField = (fields: Record<string, string>) => {
    if (fieldsLocked) return;
    if (fields.offeredName !== undefined) dirtyRef.current.offeredName = true;
    if (fields.customerFacingNotes !== undefined) {
      dirtyRef.current.customerFacingNotes = true;
    }
    if (fields.availability !== undefined || fields.fulfillmentType !== undefined) {
      dirtyRef.current.fulfillmentType = true;
    }
    if (fields.unavailableReason !== undefined) {
      dirtyRef.current.unavailableReason = true;
    }
    if (fields.price !== undefined) dirtyRef.current.price = true;
    if (fields.weightLbs !== undefined) dirtyRef.current.weightLbs = true;
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
          <div style={wrapRowStyle}>
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
          </div>
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

            <div style={wrapRowStyle}>
              <s-stack direction="block" gap="small">
                <label htmlFor={`price-${item.id}`}>
                  <s-text color="subdued">Price</s-text>
                </label>
                <ReplaceZeroNumberInput
                  id={`price-${item.id}`}
                  value={price}
                  step={0.01}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onValueChange={setPrice}
                  onCommit={(next) => saveField({ price: String(next) })}
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
                <ReplaceZeroNumberInput
                  id={`weight-${item.id}`}
                  value={weightLbs}
                  step={0.1}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onValueChange={setWeightLbs}
                  onCommit={(next) => saveField({ weightLbs: String(next) })}
                  style={fieldsLocked ? disabledNumberInputStyle : numberInputStyle}
                />
              </s-stack>
            </div>

            {/*
              A Grower's Choice customer is not being sold the plant in the
              photo, so the offer carries the store listing's image instead and
              photographing an individual would be a promise nobody can keep.
            */}
            {growersChoice ? null : (
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Exact plant photos</s-text>
              {canEdit && item.photos.length > 0 ? (
                <PhotoReorderStrip
                  itemId={item.id}
                  photos={item.photos}
                  alt={item.offeredName || item.plantName}
                />
              ) : (
                <div style={wrapRowStyle}>
                  {item.photoUrls.map((url, index) => (
                    <s-stack key={url} direction="block" gap="small">
                      <img
                        src={url}
                        alt={item.offeredName || item.plantName}
                        width={120}
                        height={120}
                        style={{
                          display: "block",
                          objectFit: "cover",
                          borderRadius: "8px",
                          maxWidth: "100%",
                        }}
                      />
                      {index === 0 ? (
                        <s-badge tone="info">Customer sees first</s-badge>
                      ) : null}
                    </s-stack>
                  ))}
                </div>
              )}
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
function PaymentLinkSection({
  paymentLink,
  requestStatus,
  invoiceVoided,
  requestPaid,
}: {
  paymentLink: string | null;
  requestStatus: RequestStatus;
  invoiceVoided: boolean;
  requestPaid: boolean;
}) {
  if (paymentLink) {
    return (
      <s-stack direction="block" gap="small">
        <s-text color="subdued">Payment link</s-text>
        <s-link href={paymentLink}>{paymentLink}</s-link>
      </s-stack>
    );
  }

  if (
    !shouldOfferAdminPaymentLinkRecovery({
      hasAcceptedItems: true,
      paymentLink,
      requestStatus,
      invoiceVoided,
      requestPaid,
    })
  ) {
    return null;
  }

  return (
    <s-stack direction="block" gap="base">
      <s-banner tone="critical">
        <s-text>
          This customer accepted plants but Shopify never created their invoice,
          so the confirmation email went out without a checkout link. Resend the
          payment link and confirmation email only to recover that failure — it
          is not how invoices are normally sent.
        </s-text>
      </s-banner>
      <Form method="post">
        <input type="hidden" name="intent" value="create-payment-link" />
        <s-button variant="primary" type="submit">
          Resend payment link / confirmation email
        </s-button>
      </Form>
    </s-stack>
  );
}

/**
 * Ends a request whose customer accepted nothing.
 *
 * Closing does not take declined Exact Plants out of the EXACT PLANTS review
 * queue — `exactPlantReleaseReason` still returns `customer_declined` on a
 * Closed unpaid request.
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
  invoiceVoided,
  requestPaid,
}: {
  response: Awaited<ReturnType<typeof getCustomerResponse>>;
  status: RequestStatus;
  paymentLink: string | null;
  inventoryHold: InventoryHold | null;
  invoiceVoided: boolean;
  requestPaid: boolean;
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
              <PaymentLinkSection
                paymentLink={paymentLink}
                requestStatus={status}
                invoiceVoided={invoiceVoided}
                requestPaid={requestPaid}
              />
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

function ShopifyDraftOrderSection({
  shop,
  draft,
}: {
  shop: string;
  draft: {
    shopifyDraftOrderGid: string | null;
    voidedAt: string | null;
  } | null;
}) {
  if (!draft) return null;
  const state = adminDraftOrderLinkState({
    shop,
    shopifyDraftOrderGid: draft.shopifyDraftOrderGid,
    voidedAt: draft.voidedAt,
  });
  if (state.kind === "none") return null;

  return (
    <s-section heading="Shopify Draft Order">
      <s-stack direction="block" gap="base">
        {state.kind === "live" ? (
          <>
            <s-link href={state.href} target="_blank">
              Open Draft Order in Shopify
            </s-link>
            <s-banner tone="warning">
              <s-text>
                The portal snapshot is what the customer accepted. Editing the
                Draft Order in Shopify does not rewrite that history. The
                invoice may then differ from the offer and customer response
                recorded here.
              </s-text>
            </s-banner>
          </>
        ) : (
          <s-text>Draft Order voided on {draft.voidedAt}</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

function AdminOverrideCloseSection({
  pendingConfirmation,
}: {
  pendingConfirmation: boolean;
}) {
  if (pendingConfirmation) {
    return (
      <s-section heading="Close Entire Request">
        <s-stack direction="block" gap="base">
          <s-banner tone="warning">
            <s-text>
              This ends the request now. It is an admin override, not a paid or
              completed closure. History, offer snapshots, and customer
              accepted/rejected answers stay. Declined Exact Plants remain
              eligible for EXACT PLANTS review. An unpaid Draft Order will be
              voided so it cannot still be paid.
            </s-text>
          </s-banner>
          <Form method="post">
            <input type="hidden" name="intent" value="admin-override-close" />
            <input type="hidden" name="confirmed" value="true" />
            <s-button variant="primary" tone="critical" type="submit">
              Confirm Close Entire Request
            </s-button>
          </Form>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading="Close Entire Request">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          End this request even if the customer has not paid or the hold has
          not run out. History is kept. A live unpaid invoice will be voided.
        </s-text>
        <Form method="post">
          <input type="hidden" name="intent" value="admin-override-close" />
          <s-button variant="secondary" type="submit">
            Close Entire Request
          </s-button>
        </Form>
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
    adminOverrideClosed,
    draftOrderAdmin,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const pendingAdminOverrideClose = Boolean(
    actionData &&
      "pendingAdminOverrideClose" in actionData &&
      actionData.pendingAdminOverrideClose,
  );
  // The action already returned these; without this the page silently ignored a
  // failed photo upload and looked as though nothing had happened.
  const actionError =
    actionData && !actionData.ok && !pendingAdminOverrideClose
      ? actionData.error
      : null;

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

      {adminOverrideClosed ? (
        <s-section>
          <s-banner tone="info">
            <s-text>
              This request was closed by admin override. It is not a paid or
              completed closure. History, offer snapshots, and customer
              accepted/rejected answers are kept. Declined Exact Plants remain
              eligible for EXACT PLANTS review.
            </s-text>
          </s-banner>
        </s-section>
      ) : null}

      {invoiceVoided ? (
        <s-section>
          <s-banner tone="warning">
            <s-text>
              The Shopify invoice for this request was deleted so it can no
              longer be paid. The draft order reference, line items and offer
              snapshot are kept here.
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
        invoiceVoided={invoiceVoided}
        requestPaid={Boolean(plantRequest.paidAt)}
      />

      <ShopifyDraftOrderSection shop={shop} draft={draftOrderAdmin} />

      {plantRequest.status !== "Closed" ? (
        <AdminOverrideCloseSection
          pendingConfirmation={pendingAdminOverrideClose}
        />
      ) : null}

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
