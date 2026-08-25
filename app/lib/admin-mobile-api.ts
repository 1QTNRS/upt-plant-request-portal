import {
  canCreateExactPlantListing,
  canDismissExactPlantFromQueue,
  countExactPlantListingFilters,
  EXACT_PLANT_LISTING_FILTER_LABELS,
  EXACT_PLANT_RELEASE_LABELS,
  exactPlantListingBucket,
  matchesExactPlantListingFilter,
  parseExactPlantListingFilter,
  type ExactPlantListingFilter,
  type ExactPlantReleaseReason,
} from "./exact-plants";
import type { ExactPlantCandidateRow, ExactPlantReview } from "./exact-plants.server";
import {
  filterAdminDashboardRequests,
  formatPlantsSummary,
  getDisplayRequestNumber,
  incompleteOfferItems,
  parseAdminDashboardStatusFilter,
  summarizeAdminDashboardStats,
  type AdminDashboardStatusFilter,
  type IncompleteOfferItem,
  type PlantRequest,
} from "./portal";
export type MobileAdminRequestRow = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  plantsRequested: string;
  status: PlantRequest["status"];
  submittedAtIso: string;
  hasResponded: boolean;
  hasExistingOrder: boolean;
};

export type MobileAdminRequestDetail = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  status: PlantRequest["status"];
  submittedAtIso: string;
  closedAtIso?: string;
  expiredAtIso?: string;
  paidAtIso?: string;
  hasResponded: boolean;
  hasExistingOrder: boolean;
  canEditItems: boolean;
  canSendOffer: boolean;
  canCloseDeclined: boolean;
  canOverrideClose: boolean;
  offerProblems: IncompleteOfferItem[];
  sentOffer?: {
    expirationDays: number;
    sentAtIso: string;
    expiresAtIso: string;
    shippingFeeOverride?: number;
  };
  internalNotes: Array<{ id: string; body: string; createdAtIso: string }>;
  items: Array<{
    id: string;
    plantName: string;
    offeredName: string;
    availability: string;
    unavailableReason?: string;
    fulfillmentType: string;
    price: number;
    weightLbs: number;
    customerRequestNotes?: string;
    customerFacingNotes: string;
    adminNotes: string;
    photoUrls: string[];
    photos: Array<{ id: string; url: string }>;
    linkedStock?: {
      productTitle: string;
      variantTitle: string;
      variantGid: string;
      sku?: string;
      price?: number;
      weightLbs?: number;
      inventoryQuantity?: number;
      imageUrl?: string;
    };
  }>;
};

export function toMobileAdminRequestRow(
  request: PlantRequest,
): MobileAdminRequestRow {
  return {
    id: request.id,
    requestNumber: getDisplayRequestNumber(request),
    customer: request.customer,
    email: request.email,
    plantsRequested: formatPlantsSummary(request.items),
    status: request.status,
    submittedAtIso: request.submittedAtIso,
    hasResponded: request.hasResponded,
    hasExistingOrder: request.hasExistingOrder === true,
  };
}

export function toMobileAdminRequestDetail(
  request: PlantRequest,
  extras: {
    canCloseDeclined?: boolean;
    internalNotes?: MobileAdminRequestDetail["internalNotes"];
  } = {},
): MobileAdminRequestDetail {
  const offerProblems = incompleteOfferItems(request.items);
  return {
    id: request.id,
    requestNumber: getDisplayRequestNumber(request),
    customer: request.customer,
    email: request.email,
    status: request.status,
    submittedAtIso: request.submittedAtIso,
    closedAtIso: request.closedAtIso,
    expiredAtIso: request.expiredAtIso,
    paidAtIso: request.paidAtIso,
    hasResponded: request.hasResponded,
    hasExistingOrder: request.hasExistingOrder === true,
    canEditItems: request.status === "New",
    canSendOffer: request.status === "New" && offerProblems.length === 0,
    canCloseDeclined: Boolean(extras.canCloseDeclined),
    canOverrideClose: request.status !== "Closed",
    offerProblems,
    sentOffer: request.sentOffer
      ? {
          expirationDays: request.sentOffer.expirationDays,
          sentAtIso: request.sentOffer.sentAtIso,
          expiresAtIso: request.sentOffer.expiresAtIso,
          ...(request.sentOffer.shippingFeeOverride !== undefined
            ? { shippingFeeOverride: request.sentOffer.shippingFeeOverride }
            : {}),
        }
      : undefined,
    internalNotes: extras.internalNotes ?? [],
    items: request.items.map((item) => ({
      id: item.id,
      plantName: item.plantName,
      offeredName: item.offeredName,
      availability: item.availability,
      unavailableReason:
        item.availability === "not_available" ? item.unavailableReason : undefined,
      fulfillmentType: item.fulfillmentType,
      price: item.price,
      weightLbs: item.weightLbs,
      customerRequestNotes: item.customerRequestNotes,
      customerFacingNotes: item.customerFacingNotes,
      adminNotes: item.adminNotes,
      photoUrls: item.photoUrls,
      photos: item.photos,
      linkedStock: item.linkedStock
        ? {
            productTitle: item.linkedStock.productTitle,
            variantTitle: item.linkedStock.variantTitle,
            variantGid: item.linkedStock.variantGid,
            sku: item.linkedStock.sku,
            price: item.linkedStock.variantPrice,
            weightLbs: item.linkedStock.variantWeightLbs,
            inventoryQuantity: item.linkedStock.inventoryQuantity,
            imageUrl: item.linkedStock.imageUrl,
          }
        : undefined,
    })),
  };
}

export function mobileAdminDashboardPayload(
  shop: string,
  requests: PlantRequest[],
  query: string,
  status: string | null,
): {
  shop: string;
  query: string;
  statusFilter: AdminDashboardStatusFilter;
  stats: ReturnType<typeof summarizeAdminDashboardStats>;
  requests: MobileAdminRequestRow[];
} {
  const statusFilter = parseAdminDashboardStatusFilter(status);
  const filtered = filterAdminDashboardRequests(requests, query, statusFilter);
  return {
    shop,
    query,
    statusFilter,
    stats: summarizeAdminDashboardStats(requests),
    requests: filtered.map(toMobileAdminRequestRow),
  };
}

export type MobileExactPlantRow = {
  requestItemId: string;
  requestId: string;
  requestNumber: string;
  title: string;
  price: number;
  weightLbs: number;
  photoUrl?: string;
  releaseReason: ExactPlantReleaseReason;
  releaseLabel: string;
  listingStatus: ExactPlantListingFilter;
  listingLabel: string;
  eligibleAt: string;
  canDismiss: boolean;
  canList: boolean;
  productAdminUrl?: string;
  lastError?: string;
};

export type MobileExactPlantReview = {
  requestItemId: string;
  requestId: string;
  releaseReason: ExactPlantReleaseReason;
  releaseLabel: string;
  draft: ExactPlantReview["draft"];
  listing: ExactPlantReview["listing"];
  canDismiss: boolean;
  canList: boolean;
  listed: boolean;
};

export function toMobileExactPlantRow(
  item: ExactPlantCandidateRow,
  options: { dismissed?: boolean } = {},
): MobileExactPlantRow {
  const dismissed = Boolean(options.dismissed || item.dismissedAt);
  const listingStatus: ExactPlantListingFilter = dismissed
    ? "dismissed"
    : exactPlantListingBucket(item);
  return {
    requestItemId: item.requestItemId,
    requestId: item.requestId,
    requestNumber: item.requestNumber,
    title: item.title,
    price: item.price,
    weightLbs: item.weightLbs,
    photoUrl: item.photoUrls[0],
    releaseReason: item.releaseReason,
    releaseLabel: EXACT_PLANT_RELEASE_LABELS[item.releaseReason],
    listingStatus,
    listingLabel: EXACT_PLANT_LISTING_FILTER_LABELS[listingStatus],
    eligibleAt: item.eligibleAt,
    canDismiss: !dismissed && canDismissExactPlantFromQueue({ listing: item.listing }),
    canList: !dismissed && canCreateExactPlantListing({ listing: item.listing }),
    productAdminUrl: item.listing?.productAdminUrl,
    lastError: item.listing?.lastError,
  };
}

export function toMobileExactPlantReview(review: ExactPlantReview): MobileExactPlantReview {
  const listed = Boolean(
    review.listing?.status === "listed" && review.listing.shopifyProductGid,
  );
  return {
    requestItemId: review.requestItemId,
    requestId: review.requestId,
    releaseReason: review.releaseReason,
    releaseLabel: EXACT_PLANT_RELEASE_LABELS[review.releaseReason],
    draft: review.draft,
    listing: review.listing,
    canDismiss: canDismissExactPlantFromQueue({ listing: review.listing }),
    canList: canCreateExactPlantListing({ listing: review.listing }),
    listed,
  };
}

export function mobileAdminExactPlantsPayload(
  items: ExactPlantCandidateRow[],
  dismissed: ExactPlantCandidateRow[],
  listing: string | null,
): {
  listingFilter: ExactPlantListingFilter;
  counts: Record<ExactPlantListingFilter, number>;
  items: MobileExactPlantRow[];
} {
  const listingFilter = parseExactPlantListingFilter(listing);
  const counts = {
    ...countExactPlantListingFilters(items),
    dismissed: dismissed.length,
  };
  const visible =
    listingFilter === "dismissed"
      ? dismissed.map((item) => toMobileExactPlantRow(item, { dismissed: true }))
      : items
          .filter((item) => matchesExactPlantListingFilter(item, listingFilter))
          .map((item) => toMobileExactPlantRow(item));
  return { listingFilter, counts, items: visible };
}
