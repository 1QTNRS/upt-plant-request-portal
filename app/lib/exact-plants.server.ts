import type { AdminContext } from "./admin-auth.server";
import prisma from "../db.server";
import { requireAdminClient } from "./environment.server";
import {
  buildExactPlantListingDraft,
  declinedExactPlantIneligibilityReason,
  isDeclinedExactPlant,
  parsePhotoUrlList,
  shopifyAdminProductUrl,
  shopifyStorefrontProductUrl,
  type ExactPlantListingDraft,
  type ExactPlantListingRecord,
  type ExactPlantListingStatus,
} from "./exact-plants";
import { normalizePrice, normalizeWeight } from "./portal";
import { createExactPlantShopifyProduct } from "./shopify-ops.server";

type GraphqlClient = NonNullable<AdminContext["admin"]>;

export class ExactPlantListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactPlantListingError";
  }
}

export type DeclinedExactPlantRow = {
  requestItemId: string;
  requestId: string;
  requestNumber: string;
  title: string;
  price: number;
  weightLbs: number;
  photoUrls: string[];
  listing: {
    status: ExactPlantListingStatus;
    shopifyProductGid?: string;
    shopifyProductHandle?: string;
    productAdminUrl?: string;
    productStoreUrl?: string;
    lastError?: string;
  } | null;
};

export type DeclinedExactPlantReview = {
  requestItemId: string;
  requestId: string;
  draft: ExactPlantListingDraft;
  listing: DeclinedExactPlantRow["listing"];
};

function listingDto(
  shop: string,
  listing: {
    status: string;
    shopifyProductGid: string | null;
    shopifyProductHandle: string | null;
    lastError: string | null;
  } | null,
): DeclinedExactPlantRow["listing"] {
  if (!listing) return null;
  const status: ExactPlantListingStatus =
    listing.status === "listed" && listing.shopifyProductGid ? "listed" : "failed";
  return {
    status,
    shopifyProductGid: listing.shopifyProductGid ?? undefined,
    shopifyProductHandle: listing.shopifyProductHandle ?? undefined,
    productAdminUrl: shopifyAdminProductUrl(shop, listing.shopifyProductGid),
    productStoreUrl: shopifyStorefrontProductUrl(shop, listing.shopifyProductHandle),
    lastError: listing.lastError ?? undefined,
  };
}

function toListingRecord(
  row: {
    requestItemId: string;
    title: string;
    price: number;
    weightLbs: number;
    photoUrlsJson: string;
    status: string;
    shopifyProductGid: string | null;
    shopifyProductHandle: string | null;
    lastError: string | null;
  },
): ExactPlantListingRecord {
  return {
    requestItemId: row.requestItemId,
    title: row.title,
    price: row.price,
    weightLbs: row.weightLbs,
    photoUrls: parsePhotoUrlList(row.photoUrlsJson),
    status: row.status === "listed" && row.shopifyProductGid ? "listed" : "failed",
    shopifyProductGid: row.shopifyProductGid ?? undefined,
    shopifyProductHandle: row.shopifyProductHandle ?? undefined,
    lastError: row.lastError ?? undefined,
  };
}

export async function listDeclinedExactPlants(
  shop: string,
  requestId?: string,
): Promise<DeclinedExactPlantRow[]> {
  const responses = await prisma.responseItem.findMany({
    where: {
      choice: "reject",
      response: {
        request: {
          shop,
          ...(requestId ? { id: requestId } : {}),
        },
      },
    },
    include: {
      requestItem: {
        include: {
          exactPlantListing: true,
          offerItems: true,
          photos: { orderBy: { sortOrder: "asc" as const } },
          request: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  return responses.flatMap((responseItem) => {
    const item = responseItem.requestItem;
    const offerItem = item.offerItems[0];
    if (
      !isDeclinedExactPlant({
        offerAvailability: offerItem?.availability,
        responseChoice: responseItem.choice,
      })
    ) {
      return [];
    }

    const photoUrls =
      parsePhotoUrlList(offerItem.photoUrlsJson).length > 0
        ? parsePhotoUrlList(offerItem.photoUrlsJson)
        : item.photos.map((photo) => photo.url);
    const draft = buildExactPlantListingDraft({
      plantName: offerItem.plantName || item.offeredName || item.plantName,
      offeredName: offerItem.plantName || item.offeredName,
      price: offerItem.price,
      weightLbs: offerItem.weightLbs,
      photoUrls,
    });

    const listing = listingDto(shop, item.exactPlantListing);

    return [
      {
        requestItemId: item.id,
        requestId: item.requestId,
        requestNumber: item.request.requestNumber,
        title: item.exactPlantListing?.title || draft.title,
        price: item.exactPlantListing?.price ?? draft.price,
        weightLbs: item.exactPlantListing?.weightLbs ?? draft.weightLbs,
        photoUrls: item.exactPlantListing
          ? parsePhotoUrlList(item.exactPlantListing.photoUrlsJson)
          : draft.photoUrls,
        listing,
      },
    ];
  });
}

export async function getDeclinedExactPlantReview(
  shop: string,
  requestItemId: string,
): Promise<DeclinedExactPlantReview> {
  const item = await prisma.requestItem.findFirst({
    where: { id: requestItemId, request: { shop } },
    include: {
      exactPlantListing: true,
      offerItems: true,
      photos: { orderBy: { sortOrder: "asc" as const } },
      responseItems: true,
      request: true,
    },
  });

  if (!item) {
    throw new ExactPlantListingError("Declined exact plant not found.");
  }

  const offerItem = item.offerItems[0];
  const responseItem =
    item.responseItems.find((entry) => entry.choice === "reject") ??
    item.responseItems[0];
  const reason = declinedExactPlantIneligibilityReason({
    hasOfferItem: Boolean(offerItem),
    offerAvailability: offerItem?.availability,
    responseChoice: responseItem?.choice,
  });
  if (reason || !offerItem) {
    throw new ExactPlantListingError(
      reason ?? "This item was never offered as an exact plant.",
    );
  }

  const photoUrls =
    parsePhotoUrlList(offerItem.photoUrlsJson).length > 0
      ? parsePhotoUrlList(offerItem.photoUrlsJson)
      : item.photos.map((photo) => photo.url);

  const draft = buildExactPlantListingDraft({
    plantName: offerItem.plantName || item.offeredName || item.plantName,
    offeredName: offerItem.plantName || item.offeredName,
    price: offerItem.price,
    weightLbs: offerItem.weightLbs,
    photoUrls,
    customerFacingNotes: offerItem?.customerFacingNotes ?? item.customerFacingNotes,
    customerName: item.request.customerName,
    customerEmail: item.request.customerEmail,
    requestNumber: item.request.requestNumber,
    responseChoice: responseItem?.choice,
  });

  return {
    requestItemId: item.id,
    requestId: item.requestId,
    draft: item.exactPlantListing
      ? {
          title: item.exactPlantListing.title,
          price: item.exactPlantListing.price,
          weightLbs: item.exactPlantListing.weightLbs,
          photoUrls: parsePhotoUrlList(item.exactPlantListing.photoUrlsJson),
        }
      : draft,
    listing: listingDto(shop, item.exactPlantListing),
  };
}

/**
 * Stand-in for a real `productCreate` on a demo shop. Never reachable against a
 * merchant store, where a missing Admin client raises instead so the listing is
 * recorded as failed and can be retried rather than looking published.
 */
function demoProduct(requestItemId: string): { productGid: string; handle: string } {
  const slug = requestItemId.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    productGid: `gid://shopify/Product/upt-${slug}`,
    handle: `exact-plant-${slug}`.toLowerCase(),
  };
}

export async function createExactPlantListing(
  admin: GraphqlClient | undefined,
  shop: string,
  input: {
    requestItemId: string;
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
  },
): Promise<ExactPlantListingRecord> {
  const title = input.title.trim();
  if (!title) {
    throw new ExactPlantListingError("Product title is required.");
  }

  const approved = {
    title,
    price: normalizePrice(input.price),
    weightLbs: normalizeWeight(input.weightLbs),
    photoUrls: input.photoUrls.filter((url) => url.trim().length > 0),
  };

  await getDeclinedExactPlantReview(shop, input.requestItemId);

  const existing = await prisma.exactPlantListing.findUnique({
    where: { requestItemId: input.requestItemId },
  });
  if (existing?.shopifyProductGid && existing.status === "listed") {
    await prisma.requestItem.update({
      where: { id: input.requestItemId },
      data: { itemStatus: "Listed" },
    });
    return toListingRecord(existing);
  }

  try {
    requireAdminClient(admin, shop, "Creating an EXACT PLANTS product");
    const created = admin
      ? await createExactPlantShopifyProduct(admin, {
          requestItemId: input.requestItemId,
          ...approved,
        })
      : demoProduct(input.requestItemId);

    const saved = await prisma.exactPlantListing.upsert({
      where: { requestItemId: input.requestItemId },
      create: {
        shop,
        requestItemId: input.requestItemId,
        shopifyProductGid: created.productGid,
        shopifyProductHandle: created.handle,
        title: approved.title,
        price: approved.price,
        weightLbs: approved.weightLbs,
        photoUrlsJson: JSON.stringify(approved.photoUrls),
        status: "listed",
        lastError: null,
      },
      update: {
        shopifyProductGid: created.productGid,
        shopifyProductHandle: created.handle,
        title: approved.title,
        price: approved.price,
        weightLbs: approved.weightLbs,
        photoUrlsJson: JSON.stringify(approved.photoUrls),
        status: "listed",
        lastError: null,
      },
    });

    await prisma.requestItem.update({
      where: { id: input.requestItemId },
      data: { itemStatus: "Listed" },
    });

    return toListingRecord(saved);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Exact plant listing creation failed.";
    await prisma.exactPlantListing.upsert({
      where: { requestItemId: input.requestItemId },
      create: {
        shop,
        requestItemId: input.requestItemId,
        title: approved.title,
        price: approved.price,
        weightLbs: approved.weightLbs,
        photoUrlsJson: JSON.stringify(approved.photoUrls),
        status: "failed",
        lastError: message,
      },
      update: {
        title: approved.title,
        price: approved.price,
        weightLbs: approved.weightLbs,
        photoUrlsJson: JSON.stringify(approved.photoUrls),
        status: existing?.shopifyProductGid ? "listed" : "failed",
        lastError: message,
      },
    });
    throw new ExactPlantListingError(message);
  }
}
