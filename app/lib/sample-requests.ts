import {
  getSubmittedPlantRequests,
  hydrateSubmittedRequests,
} from "./customer-request-submissions";
import { notifyLocalStateChanged } from "./local-state-events";

export type RequestStatus =
  | "New"
  | "Pending"
  | "Closed"
  | "Expired";

const LEGACY_PENDING_STATUSES = new Set([
  "Pending",
  "Awaiting Response",
  "Offers Sent",
  "Offer Sent",
]);

export function normalizeRequestStatus(status: string): RequestStatus {
  if (status === "New") return "New";
  if (status === "Closed" || status === "Purchased") return "Closed";
  if (status === "Expired") return "Expired";
  if (LEGACY_PENDING_STATUSES.has(status)) return "Pending";
  return "New";
}

export type OfferExpirationDays = 3 | 5 | 7;

export type SentOffer = {
  offerLink: string;
  sentAt: string;
  expiresAt: string;
  expirationDays: OfferExpirationDays;
};

export type PlantItemStatus =
  | "Requested"
  | "Sourced"
  | "Offered"
  | "Sold"
  | "Unavailable";

export type PlantItem = {
  id: string;
  plantName: string;
  quantity: number;
  itemStatus: PlantItemStatus;
  price: number;
  weightLbs: number;
  adminNotes: string;
  photoPreviewUrl: string;
};

export type PlantRequest = {
  id: string;
  requestNumber?: string;
  customer: string;
  email: string;
  status: RequestStatus;
  submittedDate: string;
  items: PlantItem[];
};

export function getDisplayRequestNumber(request: PlantRequest): string {
  return request.requestNumber ?? `UPT-REQ-${request.id}`;
}

export function isOfferReadyForCustomer(requestId: string): boolean {
  hydrateSampleOfferState();
  const request = getRequestById(requestId);
  if (!request) return false;

  const status = getEffectiveRequestStatus(requestId, request.status);
  return status === "Pending" && Boolean(getSentOffer(requestId));
}

export const SAMPLE_REQUESTS: PlantRequest[] = [
  {
    id: "1",
    customer: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    status: "New",
    submittedDate: "Jun 4, 2026",
    items: [
      {
        id: "1-1",
        plantName: "Monstera Deliciosa",
        quantity: 1,
        itemStatus: "Requested",
        price: 85,
        weightLbs: 12,
        adminNotes: "Customer prefers medium size with fenestrations.",
        photoPreviewUrl: "https://picsum.photos/seed/monstera/320/320",
      },
      {
        id: "1-2",
        plantName: "Fiddle Leaf Fig",
        quantity: 1,
        itemStatus: "Requested",
        price: 120,
        weightLbs: 18,
        adminNotes: "Needs to fit a bright corner spot.",
        photoPreviewUrl: "https://picsum.photos/seed/fiddleleaf/320/320",
      },
    ],
  },
  {
    id: "2",
    customer: "James Chen",
    email: "j.chen@email.com",
    status: "Pending",
    submittedDate: "Jun 3, 2026",
    items: [
      {
        id: "2-1",
        plantName: "Snake Plant",
        quantity: 1,
        itemStatus: "Sourced",
        price: 45,
        weightLbs: 8,
        adminNotes: "Low-light tolerant varieties only.",
        photoPreviewUrl: "https://picsum.photos/seed/snakeplant/320/320",
      },
      {
        id: "2-2",
        plantName: "ZZ Plant",
        quantity: 1,
        itemStatus: "Sourced",
        price: 55,
        weightLbs: 6,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/zzplant/320/320",
      },
      {
        id: "2-3",
        plantName: "Pothos",
        quantity: 1,
        itemStatus: "Requested",
        price: 28,
        weightLbs: 3,
        adminNotes: "Trailing variety preferred.",
        photoPreviewUrl: "https://picsum.photos/seed/pothos/320/320",
      },
    ],
  },
  {
    id: "3",
    customer: "Emily Rodriguez",
    email: "emily.r@email.com",
    status: "Pending",
    submittedDate: "Jun 2, 2026",
    items: [
      {
        id: "3-1",
        plantName: "Bird of Paradise",
        quantity: 1,
        itemStatus: "Offered",
        price: 150,
        weightLbs: 22,
        adminNotes: "Offer sent with delivery estimate.",
        photoPreviewUrl: "https://picsum.photos/seed/birdofparadise/320/320",
      },
    ],
  },
  {
    id: "4",
    customer: "Michael Thompson",
    email: "m.thompson@email.com",
    status: "Closed",
    submittedDate: "May 30, 2026",
    items: [
      {
        id: "4-1",
        plantName: "Rubber Plant",
        quantity: 1,
        itemStatus: "Sold",
        price: 65,
        weightLbs: 10,
        adminNotes: "Purchased and fulfilled.",
        photoPreviewUrl: "https://picsum.photos/seed/rubberplant/320/320",
      },
      {
        id: "4-2",
        plantName: "Peace Lily",
        quantity: 1,
        itemStatus: "Sold",
        price: 38,
        weightLbs: 5,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/peacelily/320/320",
      },
    ],
  },
  {
    id: "5",
    customer: "Lisa Park",
    email: "lisa.park@email.com",
    status: "Expired",
    submittedDate: "May 28, 2026",
    items: [
      {
        id: "5-1",
        plantName: "Calathea",
        quantity: 1,
        itemStatus: "Unavailable",
        price: 0,
        weightLbs: 4,
        adminNotes: "Could not source before offer expired.",
        photoPreviewUrl: "https://picsum.photos/seed/calathea/320/320",
      },
      {
        id: "5-2",
        plantName: "Alocasia",
        quantity: 1,
        itemStatus: "Unavailable",
        price: 0,
        weightLbs: 6,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/alocasia/320/320",
      },
    ],
  },
  {
    id: "6",
    customer: "David Wilson",
    email: "d.wilson@email.com",
    status: "New",
    submittedDate: "Jun 5, 2026",
    items: [
      {
        id: "6-1",
        plantName: "Philodendron Brasil",
        quantity: 1,
        itemStatus: "Requested",
        price: 32,
        weightLbs: 4,
        adminNotes: "Hanging basket if available.",
        photoPreviewUrl: "https://picsum.photos/seed/philodendron/320/320",
      },
      {
        id: "6-2",
        plantName: "Hoya",
        quantity: 1,
        itemStatus: "Requested",
        price: 40,
        weightLbs: 2,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/hoya/320/320",
      },
    ],
  },
];

const OFFER_STATE_STORAGE_KEY = "upt-sample-offer-state";

type StoredOfferState = {
  offers: Record<string, SentOffer>;
  statuses: Record<string, RequestStatus>;
};

const sentOffersByRequestId = new Map<string, SentOffer>();
const statusByRequestId = new Map<string, RequestStatus>();
let offerStateHydrated = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function persistOfferState(): void {
  if (!isBrowser()) return;

  const offers: Record<string, SentOffer> = {};
  const statuses: Record<string, RequestStatus> = {};

  for (const [requestId, offer] of sentOffersByRequestId.entries()) {
    offers[requestId] = offer;
  }

  for (const [requestId, status] of statusByRequestId.entries()) {
    statuses[requestId] = status;
  }

  localStorage.setItem(
    OFFER_STATE_STORAGE_KEY,
    JSON.stringify({ offers, statuses }),
  );
  notifyLocalStateChanged();
}

export function hydrateSampleOfferState(): void {
  if (!isBrowser()) return;

  try {
    const raw = localStorage.getItem(OFFER_STATE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as StoredOfferState;

    for (const [requestId, offer] of Object.entries(parsed.offers ?? {})) {
      sentOffersByRequestId.set(requestId, offer);
    }

    for (const [requestId, status] of Object.entries(parsed.statuses ?? {})) {
      statusByRequestId.set(requestId, normalizeRequestStatus(status));
    }
  } catch {
    // Ignore invalid stored state during local testing.
  }

  offerStateHydrated = true;
}

function formatOfferDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function getEffectiveRequestStatus(
  requestId: string,
  fallback: RequestStatus,
): RequestStatus {
  hydrateSampleOfferState();
  const stored = statusByRequestId.get(requestId);
  if (stored) return stored;
  return fallback;
}

export function getSentOffer(requestId: string): SentOffer | undefined {
  hydrateSampleOfferState();
  return sentOffersByRequestId.get(requestId);
}

export function sendOfferToCustomer(
  requestId: string,
  expirationDays: OfferExpirationDays,
): SentOffer | null {
  hydrateSampleOfferState();

  const request = getRequestById(requestId);
  if (!request) return null;

  const currentStatus = getEffectiveRequestStatus(requestId, request.status);
  if (currentStatus !== "New") return null;

  const sentAt = new Date();
  const expiresAt = new Date(sentAt);
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  const offer: SentOffer = {
    offerLink: `/app/customer-offer-preview?requestId=${requestId}`,
    sentAt: formatOfferDateTime(sentAt),
    expiresAt: formatOfferDateTime(expiresAt),
    expirationDays,
  };

  sentOffersByRequestId.set(requestId, offer);
  statusByRequestId.set(requestId, "Pending");
  persistOfferState();

  return offer;
}

export function getAllPlantRequests(): PlantRequest[] {
  hydrateSubmittedRequests();
  return [...getSubmittedPlantRequests(), ...SAMPLE_REQUESTS];
}

export function getBuiltInRequestById(id: string): PlantRequest | undefined {
  return SAMPLE_REQUESTS.find((request) => request.id === id);
}

export function getBuiltInRequestWithState(
  id: string,
): (PlantRequest & { sentOffer?: SentOffer }) | undefined {
  const request = getBuiltInRequestById(id);
  if (!request) return undefined;

  return {
    ...request,
    status: getEffectiveRequestStatus(id, request.status),
    sentOffer: getSentOffer(id),
  };
}

export function getRequestById(id: string): PlantRequest | undefined {
  return getAllPlantRequests().find((request) => request.id === id);
}

export function getPlantItemById(itemId: string): PlantItem | undefined {
  for (const request of getAllPlantRequests()) {
    const item = request.items.find((entry) => entry.id === itemId);
    if (item) return item;
  }

  return undefined;
}

export function getRequestWithState(
  id: string,
): (PlantRequest & { sentOffer?: SentOffer }) | undefined {
  const request = getRequestById(id);
  if (!request) return undefined;

  return {
    ...request,
    status: getEffectiveRequestStatus(id, request.status),
    sentOffer: getSentOffer(id),
  };
}

export function formatPlantsSummary(items: PlantItem[]): string {
  return items.map((item) => item.plantName).join(", ");
}

export type CustomerMyRequestRow = {
  id: string;
  requestNumber: string;
  submittedDate: string;
  plantsRequested: string;
  status: RequestStatus;
};

export function getCustomerMyRequests(email: string): CustomerMyRequestRow[] {
  hydrateSubmittedRequests();
  hydrateSampleOfferState();

  const normalizedEmail = email.trim().toLowerCase();

  return getSubmittedPlantRequests()
    .filter((request) => request.email.trim().toLowerCase() === normalizedEmail)
    .map((request) => ({
      id: request.id,
      requestNumber: getDisplayRequestNumber(request),
      submittedDate: request.submittedDate,
      plantsRequested: formatPlantsSummary(request.items),
      status: getEffectiveRequestStatus(request.id, request.status),
    }));
}

export function setRequestStatus(
  requestId: string,
  status: RequestStatus,
): void {
  hydrateSampleOfferState();
  statusByRequestId.set(requestId, status);
  persistOfferState();
}

export function resetSampleOfferState(): void {
  sentOffersByRequestId.clear();
  statusByRequestId.clear();
  offerStateHydrated = false;

  if (isBrowser()) {
    localStorage.removeItem(OFFER_STATE_STORAGE_KEY);
  }
}
