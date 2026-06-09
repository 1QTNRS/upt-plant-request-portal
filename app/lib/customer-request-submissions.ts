import { notifyLocalStateChanged } from "./local-state-events";
import {
  type PlantItem,
  type PlantRequest,
  type RequestStatus,
} from "./sample-requests";

function normalizeSubmittedStatus(status: string): RequestStatus {
  if (status === "New") return "New";
  if (status === "Closed" || status === "Purchased") return "Closed";
  if (status === "Expired") return "Expired";
  if (
    status === "Pending" ||
    status === "Offer Sent" ||
    status === "Awaiting Response" ||
    status === "Offers Sent"
  ) {
    return "Pending";
  }

  return "New";
}

const SUBMITTED_REQUESTS_STORAGE_KEY = "upt-customer-submitted-requests";
const CUSTOMER_LOGGED_IN_STORAGE_KEY = "upt-customer-logged-in-prototype";
const CUSTOMER_PROFILE_STORAGE_KEY = "upt-customer-profile-prototype";

export const PROTOTYPE_CUSTOMER_PROFILE = {
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
};

export type PrototypeCustomerProfile = {
  name: string;
  email: string;
};

export type CustomerRequestFormItem = {
  plantName: string;
  budget?: string;
  notes?: string;
};

export type CustomerRequestFormSubmission = {
  name: string;
  email: string;
  items: CustomerRequestFormItem[];
};

export type CustomerRequestSubmissionResult = {
  requestId: string;
  requestNumber: string;
  request: PlantRequest;
};

const submittedRequests: PlantRequest[] = [];
let submittedRequestsHydrated = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function formatSubmittedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizePlantItem(
  item: Partial<PlantItem>,
  index: number,
  requestId: string,
): PlantItem {
  return {
    id: item.id ?? `${requestId}-${index + 1}`,
    plantName: item.plantName ?? "",
    quantity: item.quantity ?? 1,
    itemStatus: item.itemStatus ?? "Requested",
    price: item.price ?? 0,
    weightLbs: item.weightLbs ?? 0,
    adminNotes: item.adminNotes ?? "",
    photoPreviewUrl:
      item.photoPreviewUrl ??
      `https://picsum.photos/seed/${requestId}-${index + 1}/320/320`,
  };
}

export function normalizeSubmittedPlantRequest(
  raw: Partial<PlantRequest>,
): PlantRequest | null {
  if (!raw.id) return null;

  return {
    id: raw.id,
    requestNumber: raw.requestNumber,
    customer: raw.customer ?? "",
    email: raw.email ?? "",
    status: normalizeSubmittedStatus(String(raw.status ?? "New")),
    submittedDate: raw.submittedDate ?? "",
    items: (raw.items ?? []).map((item, index) =>
      normalizePlantItem(item, index, raw.id!),
    ),
  };
}

function persistSubmittedRequests(): void {
  if (!isBrowser()) return;
  localStorage.setItem(
    SUBMITTED_REQUESTS_STORAGE_KEY,
    JSON.stringify(submittedRequests),
  );
  notifyLocalStateChanged();
}

export function hydrateSubmittedRequests(): void {
  if (!isBrowser()) return;

  try {
    const raw = localStorage.getItem(SUBMITTED_REQUESTS_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Partial<PlantRequest>[];
    const normalized = parsed
      .map((entry) => normalizeSubmittedPlantRequest(entry))
      .filter((entry): entry is PlantRequest => entry !== null);
    submittedRequests.splice(0, submittedRequests.length, ...normalized);
  } catch {
    // Ignore invalid stored submissions during local testing.
  }

  submittedRequestsHydrated = true;
}

export function getSubmittedPlantRequests(): PlantRequest[] {
  hydrateSubmittedRequests();
  return [...submittedRequests];
}

export function isCustomerLoggedInPrototype(): boolean {
  if (!isBrowser()) return false;
  return localStorage.getItem(CUSTOMER_LOGGED_IN_STORAGE_KEY) === "true";
}

export function getPrototypeCustomerProfile(): PrototypeCustomerProfile {
  if (!isBrowser()) {
    return { name: "", email: "" };
  }

  try {
    const raw = localStorage.getItem(CUSTOMER_PROFILE_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as PrototypeCustomerProfile;
    }
  } catch {
    // Fall back to the default prototype profile.
  }

  return { ...PROTOTYPE_CUSTOMER_PROFILE };
}

export function setCustomerLoggedInPrototype(loggedIn: boolean): void {
  if (!isBrowser()) return;

  if (loggedIn) {
    localStorage.setItem(CUSTOMER_LOGGED_IN_STORAGE_KEY, "true");
    localStorage.setItem(
      CUSTOMER_PROFILE_STORAGE_KEY,
      JSON.stringify(PROTOTYPE_CUSTOMER_PROFILE),
    );
  } else {
    localStorage.removeItem(CUSTOMER_LOGGED_IN_STORAGE_KEY);
    localStorage.removeItem(CUSTOMER_PROFILE_STORAGE_KEY);
  }
}

function buildAdminNotes(item: CustomerRequestFormItem): string {
  const parts: string[] = [];

  if (item.budget?.trim()) {
    parts.push(`Customer budget: ${item.budget.trim()}`);
  }

  if (item.notes?.trim()) {
    parts.push(item.notes.trim());
  }

  return parts.join(" | ");
}

function createPlantItems(
  requestId: string,
  items: CustomerRequestFormItem[],
): PlantItem[] {
  return items.map((item, index) => ({
    id: `${requestId}-${index + 1}`,
    plantName: item.plantName.trim(),
    quantity: 1,
    itemStatus: "Requested" as const,
    price: 0,
    weightLbs: 0,
    adminNotes: buildAdminNotes(item),
    photoPreviewUrl: `https://picsum.photos/seed/${requestId}-${index + 1}/320/320`,
  }));
}

function generateRequestNumber(): string {
  const year = new Date().getFullYear();
  const suffix = String(Date.now()).slice(-6);
  return `UPT-REQ-${year}-${suffix}`;
}

export function submitCustomerRequest(
  submission: CustomerRequestFormSubmission,
): CustomerRequestSubmissionResult {
  hydrateSubmittedRequests();

  const requestId = `sub-${Date.now()}`;
  const requestNumber = generateRequestNumber();
  const submittedDate = formatSubmittedDate(new Date());

  const request: PlantRequest = {
    id: requestId,
    requestNumber,
    customer: submission.name.trim(),
    email: submission.email.trim(),
    status: "New",
    submittedDate,
    items: createPlantItems(
      requestId,
      submission.items.map((item) => ({
        plantName: item.plantName,
        budget: item.budget,
        notes: item.notes,
      })),
    ),
  };

  submittedRequests.unshift(request);
  persistSubmittedRequests();

  return { requestId, requestNumber, request };
}

export function resetSubmittedRequests(): void {
  submittedRequests.splice(0, submittedRequests.length);
  submittedRequestsHydrated = false;

  if (isBrowser()) {
    localStorage.removeItem(SUBMITTED_REQUESTS_STORAGE_KEY);
    localStorage.removeItem(CUSTOMER_LOGGED_IN_STORAGE_KEY);
    localStorage.removeItem(CUSTOMER_PROFILE_STORAGE_KEY);
  }
}
