import {
  filterAdminDashboardRequests,
  formatPlantsSummary,
  getDisplayRequestNumber,
  parseAdminDashboardStatusFilter,
  summarizeAdminDashboardStats,
  type AdminDashboardStatusFilter,
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
): MobileAdminRequestDetail {
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
