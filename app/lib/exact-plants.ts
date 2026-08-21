import { normalizePrice, normalizeWeight } from "./portal";

export const EXACT_PLANTS_COLLECTION_TITLE = "EXACT PLANTS";
export const EXACT_PLANT_PRODUCT_TYPE = "Exact Plant";
export const EXACT_PLANT_VENDOR = "UPT";
export const EXACT_PLANT_ITEM_TAG_PREFIX = "upt-declined-item:";

export type ExactPlantListingStatus = "listed" | "failed";

export type ExactPlantListingDraft = {
  title: string;
  price: number;
  weightLbs: number;
  photoUrls: string[];
};

export type ExactPlantListingRecord = ExactPlantListingDraft & {
  requestItemId: string;
  status: ExactPlantListingStatus;
  shopifyProductGid?: string;
  shopifyProductHandle?: string;
  lastError?: string;
};

/**
 * Idempotency tag on the Shopify product. The `declined` wording predates
 * expired offers becoming eligible; it is kept because renaming it would orphan
 * the products already created under it and allow duplicates.
 */
export function declinedItemTag(requestItemId: string): string {
  return `${EXACT_PLANT_ITEM_TAG_PREFIX}${requestItemId}`;
}

/**
 * Why an exact plant is no longer held for the customer who was offered it, and
 * so may be listed publicly. Kept distinct because they mean different things
 * commercially and analytics reports them separately.
 */
export type ExactPlantReleaseReason =
  | "customer_declined"
  | "accepted_unpaid_expired"
  | "never_responded_expired";

export const EXACT_PLANT_RELEASE_LABELS: Record<ExactPlantReleaseReason, string> = {
  customer_declined: "Customer Declined",
  accepted_unpaid_expired: "Customer Accepted but Unpaid/Expired",
  never_responded_expired: "Customer Never Responded/Expired",
};

export type ExactPlantEligibilityInput = {
  hasOfferItem: boolean;
  offerAvailability?: string | null;
  /** Undefined or null when the customer never answered the offer. */
  responseChoice?: string | null;
  requestStatus?: string | null;
  /** Truthy once the request has been paid for. */
  paidAt?: unknown;
};

/**
 * The reason this item may be listed, or null when it is not eligible.
 *
 * An item is only ever released while it is not promised to anyone: the
 * customer declined it, or their hold lapsed unpaid. A plant UPT marked Not
 * Available is never eligible — there is no exact plant to sell — and a paid or
 * closed request is never touched.
 */
export function exactPlantReleaseReason(
  input: ExactPlantEligibilityInput,
): ExactPlantReleaseReason | null {
  if (!input.hasOfferItem) return null;
  if (input.offerAvailability !== "available") return null;
  // A sold plant stays sold; completed requests are out of scope entirely.
  if (input.paidAt) return null;
  if (input.requestStatus === "Closed") return null;

  if (input.responseChoice === "reject") return "customer_declined";

  if (input.requestStatus === "Expired") {
    if (input.responseChoice === "accept") return "accepted_unpaid_expired";
    if (!input.responseChoice) return "never_responded_expired";
  }

  return null;
}

export function isExactPlantEligible(input: ExactPlantEligibilityInput): boolean {
  return exactPlantReleaseReason(input) !== null;
}

/** A message explaining why this item cannot be listed, for the review form. */
export function exactPlantIneligibilityReason(
  input: ExactPlantEligibilityInput,
): string | null {
  if (exactPlantReleaseReason(input)) return null;

  if (!input.hasOfferItem) {
    return "This item was never offered as an exact plant.";
  }
  if (input.offerAvailability !== "available") {
    return "UPT Not Available items cannot become EXACT PLANTS listings.";
  }
  if (input.paidAt || input.requestStatus === "Closed") {
    return "This request has been paid and closed, so the plant is sold.";
  }
  if (input.responseChoice === "accept") {
    return "The customer accepted this plant and their hold has not expired yet.";
  }
  if (input.responseChoice === "unavailable") {
    return "Unavailable items cannot become EXACT PLANTS listings.";
  }
  return "This plant is still being held for the customer. It becomes eligible once they decline it or the offer expires unpaid.";
}

export function buildExactPlantListingDraft(input: {
  plantName: string;
  offeredName?: string | null;
  price: number;
  weightLbs: number;
  photoUrls?: string[] | null;
  customerFacingNotes?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  requestNumber?: string | null;
  responseChoice?: string | null;
}): ExactPlantListingDraft {
  const title = (input.offeredName?.trim() || input.plantName).trim();
  return {
    title,
    price: normalizePrice(input.price),
    weightLbs: normalizeWeight(input.weightLbs),
    photoUrls: (input.photoUrls ?? []).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0,
    ),
  };
}

export function parsePhotoUrlList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  } catch {
    return [];
  }
}

export function shopifyAdminProductUrl(
  shop: string,
  productGid: string | null | undefined,
): string | undefined {
  if (!productGid) return undefined;
  const store = shop.replace(/\.myshopify\.com$/i, "");
  const numericId = productGid.split("/").pop();
  if (!numericId) return undefined;
  return `https://admin.shopify.com/store/${store}/products/${numericId}`;
}

export function shopifyStorefrontProductUrl(
  shop: string,
  handle: string | null | undefined,
): string | undefined {
  if (!handle) return undefined;
  return `https://${shop}/products/${handle}`;
}

/**
 * Sales channels are identified by the handle of the app behind the
 * publication, not by the catalog title.
 *
 * `Publication.catalog` is null unless the query filters on a `catalogType`,
 * and with `catalogType: APP` the title reads "Channel Catalog <id> for Online
 * Store" and is translated into the merchant's admin language. The app handle
 * is stable and untranslated.
 */
export const ONLINE_STORE_APP_HANDLE = "online_store";

/**
 * Shopify reports the Point of Sale channel as `pos`, not `point_of_sale`.
 * Read verbatim from a store, where the catalog titled "Channel Catalog … for
 * Point of Sale" is backed by an app whose handle is `pos`. Both spellings are
 * accepted because the longer one is what Shopify's own documentation implies.
 */
export const POS_APP_HANDLES = ["pos", "point_of_sale"] as const;

export function isOnlineStorePublicationHandle(
  handle: string | null | undefined,
): boolean {
  return handle?.trim().toLowerCase() === ONLINE_STORE_APP_HANDLE;
}

export function isPosPublicationHandle(
  handle: string | null | undefined,
): boolean {
  const normalized = handle?.trim().toLowerCase();
  return POS_APP_HANDLES.some((candidate) => candidate === normalized);
}

/**
 * Photo URLs Shopify can fetch when creating product media.
 *
 * Shopify downloads `originalSource` from its own network, so a `data:` URL is
 * unusable and a root-relative local-upload path has to be made absolute
 * against the app's public URL first. Dropping these silently produced listings
 * with no images, so `exactPlantMediaError` reports the difference instead.
 */
export function hostedPhotoUrls(photoUrls: string[], appUrl = ""): string[] {
  const origin = appUrl.replace(/\/+$/, "");
  return photoUrls.flatMap((url) => {
    if (/^https?:\/\//i.test(url)) return [url];
    if (url.startsWith("/") && origin.startsWith("https://")) {
      return [`${origin}${url}`];
    }
    return [];
  });
}

/**
 * Explains why approved photos cannot be published, or null when they can.
 * Listing a plant with no photo is not an acceptable silent outcome.
 */
export function exactPlantMediaError(
  photoUrls: string[],
  appUrl = "",
): string | null {
  if (photoUrls.length === 0) return null;
  if (hostedPhotoUrls(photoUrls, appUrl).length > 0) return null;
  return (
    "None of the selected photos are hosted where Shopify can fetch them. " +
    "Re-upload the photos on the request so they are stored in Shopify Files, then approve the listing again."
  );
}

/**
 * An EXACT PLANTS listing is one specific physical plant, so the variant has to
 * track inventory and refuse oversell. Without this the default variant is
 * untracked — unlimited stock — and the same plant can be sold repeatedly.
 */
export function buildExactPlantVariantInput(input: {
  variantId: string;
  price: number;
  weightLbs: number;
}) {
  return {
    id: input.variantId,
    price: normalizePrice(input.price).toFixed(2),
    inventoryPolicy: "DENY" as const,
    inventoryItem: {
      tracked: true,
      measurement: {
        weight: { value: normalizeWeight(input.weightLbs), unit: "POUNDS" as const },
      },
    },
  };
}

/** There is exactly one of each exact plant. */
export const EXACT_PLANT_STOCK_QUANTITY = 1;

/**
 * `ignoreCompareQuantity` is deprecated in 2025-10 but still mandatory there:
 * without it, or a `compareQuantity` on every entry, Shopify rejects the
 * mutation with "The compareQuantity argument must be given to each quantity or
 * ignored using ignoreCompareQuantity". Its replacement,
 * `InventoryQuantityInput.changeFromQuantity`, does not exist until 2026-01, so
 * this has to be revisited when the API version is bumped.
 */
export function buildExactPlantInventoryInput(input: {
  inventoryItemId: string;
  locationId: string;
}) {
  return {
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
    quantities: [
      {
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        quantity: EXACT_PLANT_STOCK_QUANTITY,
      },
    ],
  };
}

export function buildExactPlantProductCreateInput(input: {
  requestItemId: string;
  title: string;
  photoUrls: string[];
  collectionId: string;
  appUrl?: string;
}) {
  return {
    product: {
      title: input.title,
      status: "ACTIVE" as const,
      vendor: EXACT_PLANT_VENDOR,
      productType: EXACT_PLANT_PRODUCT_TYPE,
      tags: [EXACT_PLANTS_COLLECTION_TITLE, declinedItemTag(input.requestItemId)],
      collectionsToJoin: [input.collectionId],
    },
    media: hostedPhotoUrls(input.photoUrls, input.appUrl).map((url) => ({
      originalSource: url,
      alt: input.title,
      mediaContentType: "IMAGE" as const,
    })),
  };
}

