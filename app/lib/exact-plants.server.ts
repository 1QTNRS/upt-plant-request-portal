import type { AdminContext } from "./admin-auth.server";
import prisma from "../db.server";
import { requireAdminClient } from "./environment.server";
import {
  buildExactPlantListingDraft,
  canDismissExactPlantFromQueue,
  EXACT_PLANT_DISMISSED_REASON,
  exactPlantEligibleAt,
  exactPlantIneligibilityReason,
  exactPlantEligibleAt,
  exactPlantReleaseReason,
  type ExactPlantReleaseReason,
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

/**
 * Marks an item whose product is being created right now, so a second approval
 * cannot start its own `productCreate` for the same plant.
 */
const CREATING = "creating";
const STALE_CLAIM_MS = 5 * 60 * 1000;
const ALREADY_LISTING_MESSAGE =
  "This plant is already being listed. Refresh the page to see the result.";

export class ExactPlantListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactPlantListingError";
  }
}

export type ExactPlantCandidateRow = {
  requestItemId: string;
  requestId: string;
  requestNumber: string;
  releaseReason: ExactPlantReleaseReason;
  eligibleAt: string;
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

export type ExactPlantReview = {
  requestItemId: string;
  requestId: string;
  releaseReason: ExactPlantReleaseReason;
  draft: ExactPlantListingDraft;
  listing: ExactPlantCandidateRow["listing"];
};

function listingDto(
  shop: string,
  listing: {
    status: string;
    shopifyProductGid: string | null;
    shopifyProductHandle: string | null;
    lastError: string | null;
  } | null,
): ExactPlantCandidateRow["listing"] {
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

/**
 * Every exact plant that is no longer held for the customer it was offered to.
 *
 * Queried from the offer rather than from the customer's response, because an
 * offer that simply expired has no response rows at all — starting from the
 * response would silently miss every unanswered expired offer.
 */
export async function listExactPlantCandidates(
  shop: string,
  requestId?: string,
): Promise<ExactPlantCandidateRow[]> {
  const offerItems = await prisma.offerItem.findMany({
    where: {
      availability: "available",
      offer: {
        request: {
          shop,
          ...(requestId ? { id: requestId } : {}),
        },
      },
    },
    include: {
      offer: true,
      requestItem: {
        include: {
          exactPlantListing: true,
          photos: { orderBy: { sortOrder: "asc" as const } },
          responseItems: true,
          request: { include: { response: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  return offerItems.flatMap((offerItem) => {
    const item = offerItem.requestItem;
    if (item.exactPlantDismissedAt) return [];
    const responseItem = item.responseItems[0];
    const reason = exactPlantReleaseReason({
      hasOfferItem: true,
      offerAvailability: offerItem.availability,
      offerFulfillmentType: offerItem.fulfillmentType,
      responseChoice: responseItem?.choice,
      requestStatus: item.request.status,
      paidAt: item.request.paidAt,
    });
    if (!reason) return [];

    const offerPhotos = parsePhotoUrlList(offerItem.photoUrlsJson);
    const draft = buildExactPlantListingDraft({
      plantName: offerItem.plantName || item.offeredName || item.plantName,
      offeredName: offerItem.plantName || item.offeredName,
      price: offerItem.price,
      weightLbs: offerItem.weightLbs,
      photoUrls:
        offerPhotos.length > 0 ? offerPhotos : item.photos.map((photo) => photo.url),
    });

    return [
      {
        requestItemId: item.id,
        requestId: item.requestId,
        requestNumber: item.request.requestNumber,
        releaseReason: reason,
        eligibleAt: exactPlantEligibleAt({
          releaseReason: reason,
          respondedAt: item.request.response?.respondedAt,
          closedAt: item.request.closedAt,
          expiresAt: offerItem.offer.expiresAt,
          sentAt: offerItem.offer.sentAt,
        }),
        title: item.exactPlantListing?.title || draft.title,
        price: item.exactPlantListing?.price ?? draft.price,
        weightLbs: item.exactPlantListing?.weightLbs ?? draft.weightLbs,
        photoUrls: item.exactPlantListing
          ? parsePhotoUrlList(item.exactPlantListing.photoUrlsJson)
          : draft.photoUrls,
        listing: listingDto(shop, item.exactPlantListing),
      },
    ];
  });
}

export async function getExactPlantReview(
  shop: string,
  requestItemId: string,
): Promise<ExactPlantReview> {
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
    throw new ExactPlantListingError("Exact plant not found.");
  }

  if (item.exactPlantDismissedAt) {
    throw new ExactPlantListingError(
      "This plant was dismissed from the EXACT PLANTS queue and will not be listed.",
    );
  }

  const offerItem = item.offerItems[0];
  const responseItem = item.responseItems[0];
  const eligibility = {
    hasOfferItem: Boolean(offerItem),
    offerAvailability: offerItem?.availability,
    offerFulfillmentType: offerItem?.fulfillmentType,
    responseChoice: responseItem?.choice,
    requestStatus: item.request.status,
    paidAt: item.request.paidAt,
  };
  const releaseReason = exactPlantReleaseReason(eligibility);
  if (!releaseReason || !offerItem) {
    throw new ExactPlantListingError(
      exactPlantIneligibilityReason(eligibility) ??
        "This item was never offered as an exact plant.",
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
    releaseReason,
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

  await getExactPlantReview(shop, input.requestItemId);

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

  // Claim the item before talking to Shopify. The read above and the write
  // below are separated by a network round trip, so two approvals - two admin
  // clicks, or one click and a retried POST - could both pass it and both call
  // productCreate. The second upsert would then overwrite the first product's
  // GID, leaving a published product in the store that nothing in the database
  // points at, findable only by hand. The unique index on requestItemId is what
  // makes the claim exclusive.
  if (!existing) {
    try {
      await prisma.exactPlantListing.create({
        data: {
          shop,
          requestItemId: input.requestItemId,
          title: approved.title,
          price: approved.price,
          weightLbs: approved.weightLbs,
          photoUrlsJson: JSON.stringify(approved.photoUrls),
          status: CREATING,
        },
      });
    } catch {
      throw new ExactPlantListingError(ALREADY_LISTING_MESSAGE);
    }
  } else if (existing.status === CREATING) {
    // A claim older than this outlived whatever was holding it, so it is safe
    // to take over rather than leaving the item unlistable forever.
    const { count } = await prisma.exactPlantListing.updateMany({
      where: {
        requestItemId: input.requestItemId,
        status: CREATING,
        updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) },
      },
      data: { status: CREATING, lastError: null },
    });
    if (count === 0) throw new ExactPlantListingError(ALREADY_LISTING_MESSAGE);
  }

  // Shopify creating the product and the listing being finished are two
  // different moments, and everything between them can fail. Recording the
  // product as soon as it exists is what leaves the admin a link to it: the row
  // used to keep a null GID, so a listing that failed at the inventory step
  // left a product in the store that nothing in the app pointed at once the
  // item stopped being eligible.
  const recordProduct = async (product: {
    productGid: string;
    handle: string;
  }) => {
    await prisma.exactPlantListing.update({
      where: { requestItemId: input.requestItemId },
      data: {
        shopifyProductGid: product.productGid,
        shopifyProductHandle: product.handle,
      },
    });
  };

  try {
    requireAdminClient(admin, shop, "Creating an EXACT PLANTS product");
    const created = admin
      ? await createExactPlantShopifyProduct(
          admin,
          {
            requestItemId: input.requestItemId,
            ...approved,
            appUrl: process.env.SHOPIFY_APP_URL,
          },
          recordProduct,
        )
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
      // The GID `recordProduct` wrote is deliberately left alone: it is the
      // only link to a product Shopify has already created. A listing that did
      // not get published is still `failed` — the status stays `listed` only
      // when a previous attempt genuinely published this plant.
      update: {
        title: approved.title,
        price: approved.price,
        weightLbs: approved.weightLbs,
        photoUrlsJson: JSON.stringify(approved.photoUrls),
        status:
          existing?.status === "listed" && existing.shopifyProductGid
            ? "listed"
            : "failed",
        lastError: message,
      },
    });
    throw new ExactPlantListingError(message);
  }
}

/**
 * Remove an eligible, not-yet-listed plant from the active EXACT PLANTS queue.
 *
 * Confirmation is required. History stays: the request, customer response,
 * offer snapshot, photos, price history and analytics are not deleted. A
 * Shopify product is not created, and an already-listed product is not
 * deleted. The timestamp plus StatusEvent are what keep the item from
 * reappearing on refresh or a later maintenance run.
 */
export async function dismissExactPlantFromQueue(input: {
  shop: string;
  requestItemId: string;
  confirmed: boolean;
}): Promise<
  | { ok: true; alreadyDismissed: boolean }
  | { ok: false; error: string; pendingDismiss?: boolean }
> {
  if (!input.confirmed) {
    return {
      ok: false,
      error: "Confirm Dismiss from EXACT PLANTS to proceed.",
      pendingDismiss: true,
    };
  }

  const item = await prisma.requestItem.findFirst({
    where: { id: input.requestItemId, request: { shop: input.shop } },
    include: {
      exactPlantListing: true,
      offerItems: true,
      responseItems: true,
      request: true,
    },
  });
  if (!item) {
    return { ok: false, error: "This exact plant could not be loaded." };
  }

  if (item.exactPlantDismissedAt) {
    return { ok: true, alreadyDismissed: true };
  }

  const offerItem = item.offerItems[0];
  const responseItem = item.responseItems[0];
  const releaseReason = exactPlantReleaseReason({
    hasOfferItem: Boolean(offerItem),
    offerAvailability: offerItem?.availability,
    offerFulfillmentType: offerItem?.fulfillmentType,
    responseChoice: responseItem?.choice,
    requestStatus: item.request.status,
    paidAt: item.request.paidAt,
  });
  if (!releaseReason) {
    return { ok: false, error: "This item is not in the EXACT PLANTS queue." };
  }

  if (
    !canDismissExactPlantFromQueue({
      listing: item.exactPlantListing,
    })
  ) {
    return {
      ok: false,
      error:
        "This item already has an EXACT PLANTS listing and cannot be dismissed from the queue.",
    };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.requestItem.update({
      where: { id: item.id },
      data: { exactPlantDismissedAt: now },
    }),
    prisma.statusEvent.create({
      data: {
        requestId: item.requestId,
        fromStatus: item.request.status,
        toStatus: item.request.status,
        reason: EXACT_PLANT_DISMISSED_REASON,
      },
    }),
  ]);

  return { ok: true, alreadyDismissed: false };
}
