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

export function declinedItemTag(requestItemId: string): string {
  return `${EXACT_PLANT_ITEM_TAG_PREFIX}${requestItemId}`;
}

export function isDeclinedExactPlant(input: {
  offerAvailability?: string | null;
  responseChoice?: string | null;
}): boolean {
  return (
    input.offerAvailability === "available" && input.responseChoice === "reject"
  );
}

export function declinedExactPlantIneligibilityReason(input: {
  hasOfferItem: boolean;
  offerAvailability?: string | null;
  responseChoice?: string | null;
}): string | null {
  if (!input.hasOfferItem) {
    return "This item was never offered as an exact plant.";
  }
  if (input.offerAvailability === "not_available") {
    return "UPT Not Available items cannot become EXACT PLANTS listings.";
  }
  if (input.responseChoice === "accept") {
    return "Accepted items cannot become EXACT PLANTS listings.";
  }
  if (input.responseChoice === "unavailable") {
    return "Unavailable items cannot become EXACT PLANTS listings.";
  }
  if (input.responseChoice !== "reject") {
    return "Only plants the customer rejected after an exact-plant offer can be listed.";
  }
  if (input.offerAvailability !== "available") {
    return "Only plants UPT marked Available can become EXACT PLANTS listings.";
  }
  return null;
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

export function isOnlineStorePublicationTitle(title: string): boolean {
  return title.trim().toLowerCase() === "online store";
}

export function isPosPublicationTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized === "point of sale" ||
    normalized === "pos" ||
    normalized === "shopify pos"
  );
}

export function hostedPhotoUrls(photoUrls: string[]): string[] {
  return photoUrls.filter((url) => /^https?:\/\//i.test(url));
}

export function buildExactPlantProductCreateInput(input: {
  requestItemId: string;
  title: string;
  photoUrls: string[];
  collectionId: string;
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
    media: hostedPhotoUrls(input.photoUrls).map((url) => ({
      originalSource: url,
      alt: input.title,
      mediaContentType: "IMAGE" as const,
    })),
  };
}

