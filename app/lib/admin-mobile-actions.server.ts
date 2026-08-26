import {
  toMobileAdminRequestDetail,
  type MobileAdminRequestDetail,
} from "./admin-mobile-api";
import { notifyOfferReady } from "./emails.server";
import {
  unlinkableVariantReason,
  type StoredFulfillmentType,
} from "./growers-choice";
import { offlineAdminClient } from "./offline-admin.server";
import {
  adminOverrideCloseRequest,
  closeDeclinedRequest,
} from "./offer-response.server";
import { saveUploadedPlantPhoto } from "./photo-upload.server";
import {
  parseShippingFeeOverride,
  type ItemAvailabilityStatus,
  type OfferExpirationDays,
  type UnavailableReason,
} from "./portal";
import {
  addInternalNote,
  addItemPhotos,
  getCustomerResponse,
  getRequest,
  linkExistingStock,
  listInternalNotes,
  OfferIncompleteError,
  removeItemPhoto,
  reorderItemPhotos,
  sendOffer,
  unlinkExistingStock,
  updateRequestItem,
} from "./portal.server";
import {
  getExistingStockVariant,
  refreshFedexUpgradePrice,
  searchExistingStock,
} from "./shopify-ops.server";

export type MobileAdminActionResult = {
  ok: boolean;
  error?: string;
  pendingAdminOverrideClose?: boolean;
  sent?: boolean;
  stockSearch?: {
    itemId: string;
    term: string;
    results: Array<Record<string, unknown> & { unlinkableReason: string | null }>;
  };
  request?: MobileAdminRequestDetail;
};

export async function loadMobileAdminRequestDetail(
  shop: string,
  requestId: string,
): Promise<MobileAdminRequestDetail | null> {
  const request = await getRequest(shop, requestId);
  if (!request) return null;
  const [customerResponse, notes] = await Promise.all([
    getCustomerResponse(shop, request.id),
    listInternalNotes(shop, request.id),
  ]);
  return toMobileAdminRequestDetail(request, {
    canCloseDeclined: Boolean(
      customerResponse && !customerResponse.hasAcceptedPurchasableItems,
    ),
    internalNotes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAtIso: note.createdAtIso,
    })),
  });
}

function hasField(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function asString(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "");
}

function asStringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function asOptionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  if (!hasField(body, key)) return undefined;
  const value = Number.parseFloat(String(body[key]));
  return Number.isFinite(value) ? value : undefined;
}

export async function readMobileAdminActionBody(request: Request): Promise<{
  fields: Record<string, unknown>;
  photo?: { filename: string; mimeType: string; data: Buffer };
}> {
  const contentType = request.headers.get("content-type") || "";
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const form = await request.formData();
    const fields: Record<string, unknown> = {};
    let photo: { filename: string; mimeType: string; data: Buffer } | undefined;
    for (const [key, value] of form.entries()) {
      if (typeof File !== "undefined" && value instanceof File) {
        if (key === "photo" && value.size > 0) {
          photo = {
            filename: value.name,
            mimeType: value.type || "image/jpeg",
            data: Buffer.from(await value.arrayBuffer()),
          };
        }
        continue;
      }
      fields[key] = value;
    }
    return { fields, photo };
  }

  try {
    const json = (await request.json()) as Record<string, unknown>;
    return { fields: json && typeof json === "object" ? json : {} };
  } catch {
    return { fields: {} };
  }
}

async function withUpdatedRequest(
  shop: string,
  requestId: string,
  extra: Omit<MobileAdminActionResult, "ok" | "request"> = {},
): Promise<MobileAdminActionResult> {
  return {
    ok: true,
    ...extra,
    request: (await loadMobileAdminRequestDetail(shop, requestId)) ?? undefined,
  };
}

/**
 * The same intents the web request page uses, pointed at the same
 * `portal.server` / `shopify-ops.server` functions. The phone never writes
 * inventory or Shopify itself.
 */
export async function handleMobileAdminRequestAction(input: {
  shop: string;
  requestId: string;
  origin: string;
  fields: Record<string, unknown>;
  photo?: { filename: string; mimeType: string; data: Buffer };
}): Promise<MobileAdminActionResult> {
  const { shop, requestId, fields } = input;
  const intent = asString(fields, "intent");
  const itemId = asString(fields, "itemId");

  try {
    if (intent === "search-stock") {
      const term = asString(fields, "term") || asString(fields, "stockQuery");
      const admin = await offlineAdminClient(shop);
      const results = await searchExistingStock(admin, shop, term);
      return {
        ok: true,
        stockSearch: {
          itemId,
          term,
          results: results.map((candidate) => ({
            ...candidate,
            unlinkableReason: unlinkableVariantReason(candidate),
          })),
        },
      };
    }

    if (intent === "link-stock") {
      const admin = await offlineAdminClient(shop);
      const variant = await getExistingStockVariant(
        admin,
        shop,
        asString(fields, "variantGid"),
      );
      if (!variant) {
        return { ok: false, error: "That Shopify variant no longer exists. Search again." };
      }
      const reason = unlinkableVariantReason(variant);
      if (reason) return { ok: false, error: reason };
      await linkExistingStock(shop, { requestId, itemId, variant });
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "unlink-stock") {
      await unlinkExistingStock(shop, requestId, itemId);
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "update-item") {
      await updateRequestItem(shop, {
        requestId,
        itemId,
        offeredName: hasField(fields, "offeredName")
          ? asString(fields, "offeredName")
          : undefined,
        availability: hasField(fields, "availability")
          ? (asString(fields, "availability") as ItemAvailabilityStatus)
          : undefined,
        fulfillmentType: hasField(fields, "fulfillmentType")
          ? (asString(fields, "fulfillmentType") as StoredFulfillmentType)
          : undefined,
        unavailableReason: hasField(fields, "unavailableReason")
          ? (asString(fields, "unavailableReason") as UnavailableReason)
          : undefined,
        price: asOptionalNumber(fields, "price"),
        weightLbs: asOptionalNumber(fields, "weightLbs"),
        customerFacingNotes: hasField(fields, "customerFacingNotes")
          ? asString(fields, "customerFacingNotes")
          : undefined,
      });
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "add-photo-url") {
      const url = asString(fields, "photoUrl").trim();
      if (url) {
        await addItemPhotos(shop, requestId, itemId, [{ url }]);
      }
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "remove-photo") {
      await removeItemPhoto(shop, requestId, itemId, asString(fields, "photoId"));
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "reorder-photos") {
      await reorderItemPhotos(shop, requestId, itemId, asStringList(fields, "photoIds"));
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "upload-photo") {
      if (!input.photo) {
        return { ok: false, error: "Choose a photo to upload." };
      }
      const admin = await offlineAdminClient(shop);
      const result = await saveUploadedPlantPhoto({
        shop,
        admin,
        requestId,
        itemId,
        clientKey: asString(fields, "uploadKey"),
        file: input.photo,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "send-offer") {
      const days = Number(fields.expirationDays) as OfferExpirationDays;
      const expirationDays: OfferExpirationDays =
        days === 5 || days === 7 ? days : 3;
      const shipping = parseShippingFeeOverride(fields.shippingFeeOverride);
      if (!shipping.ok) return { ok: false, error: shipping.error };
      const admin = await offlineAdminClient(shop);
      await refreshFedexUpgradePrice(admin, shop);
      const updated = await sendOffer(shop, requestId, expirationDays, {
        shippingFeeOverride: shipping.value,
      });
      if (updated) {
        const appUrl = process.env.SHOPIFY_APP_URL || input.origin;
        await notifyOfferReady(shop, requestId, appUrl);
      }
      return withUpdatedRequest(shop, requestId, { sent: Boolean(updated) });
    }

    if (intent === "add-internal-note") {
      const note = await addInternalNote(shop, requestId, asString(fields, "note"));
      if (!note) return { ok: false, error: "Write a note before saving." };
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "close-request") {
      const result = await closeDeclinedRequest({ shop, requestId });
      if (!result.ok) return { ok: false, error: result.error };
      return withUpdatedRequest(shop, requestId);
    }

    if (intent === "admin-override-close") {
      const admin = await offlineAdminClient(shop);
      const result = await adminOverrideCloseRequest({
        shop,
        requestId,
        admin,
        confirmed: asString(fields, "confirmed") === "true",
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          pendingAdminOverrideClose: Boolean(result.pendingAdminOverrideClose),
        };
      }
      return withUpdatedRequest(shop, requestId);
    }

    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof OfferIncompleteError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }
}
