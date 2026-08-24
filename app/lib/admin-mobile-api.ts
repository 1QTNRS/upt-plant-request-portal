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
  canEditItems: boolean;
  canSendOffer: boolean;
  canCloseDeclined: boolean;
  canOverrideClose: boolean;
  offerProblems: IncompleteOfferItem[];
  sentOffer?: {
    expirationDays: number;
    sentAtIso: string;
    expiresAtIso: string;
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
