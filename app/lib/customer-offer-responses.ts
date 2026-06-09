import { notifyLocalStateChanged } from "./local-state-events";
import { setRequestStatus } from "./sample-requests";

const CUSTOMER_OFFER_RESPONSES_STORAGE_KEY = "upt-customer-offer-responses";

export type CustomerResponseItemChoice = "accept" | "reject" | "unavailable";

export type CustomerResponseItem = {
  offerItemId: string;
  sourceItemId: string;
  plantName: string;
  choice: CustomerResponseItemChoice;
  price: number;
  quantity: number;
  lineRevenue: number;
  customerNotes: string;
  unavailableReason?: string;
};

export type CustomerOfferResponse = {
  requestId: string;
  respondedAt: string;
  fedexUpgradeSelected: boolean;
  fedexUpgradePrice: number;
  hasAcceptedPurchasableItems: boolean;
  items: CustomerResponseItem[];
  closedAt?: string;
};

const responsesByRequestId = new Map<string, CustomerOfferResponse>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function formatResponseDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function hasAcceptedPurchasableItems(
  items: CustomerResponseItem[],
): boolean {
  return items.some((item) => item.choice === "accept");
}

function persistCustomerOfferResponses(): void {
  if (!isBrowser()) return;

  const stored: Record<string, CustomerOfferResponse> = {};
  for (const [requestId, response] of responsesByRequestId.entries()) {
    stored[requestId] = response;
  }

  localStorage.setItem(
    CUSTOMER_OFFER_RESPONSES_STORAGE_KEY,
    JSON.stringify(stored),
  );
  notifyLocalStateChanged();
}

export function hydrateCustomerOfferResponses(): void {
  if (!isBrowser()) return;

  try {
    const raw = localStorage.getItem(CUSTOMER_OFFER_RESPONSES_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Record<string, CustomerOfferResponse>;
    for (const [requestId, response] of Object.entries(parsed)) {
      responsesByRequestId.set(requestId, {
        ...response,
        hasAcceptedPurchasableItems:
          response.hasAcceptedPurchasableItems ??
          hasAcceptedPurchasableItems(response.items ?? []),
      });
    }
  } catch {
    // Ignore invalid stored responses during local testing.
  }
}

export function getCustomerOfferResponse(
  requestId: string,
): CustomerOfferResponse | undefined {
  hydrateCustomerOfferResponses();
  return responsesByRequestId.get(requestId);
}

export function saveCustomerOfferResponse(
  response: Omit<CustomerOfferResponse, "respondedAt"> & {
    respondedAt?: string;
  },
): CustomerOfferResponse {
  hydrateCustomerOfferResponses();

  const saved: CustomerOfferResponse = {
    ...response,
    hasAcceptedPurchasableItems:
      response.hasAcceptedPurchasableItems ??
      hasAcceptedPurchasableItems(response.items),
    respondedAt: response.respondedAt ?? formatResponseDateTime(new Date()),
  };

  responsesByRequestId.set(response.requestId, saved);
  persistCustomerOfferResponses();

  return saved;
}

export function closeCustomerRequest(
  requestId: string,
  options?: {
    items?: CustomerResponseItem[];
    fedexUpgradeSelected?: boolean;
    fedexUpgradePrice?: number;
    hasAcceptedPurchasableItems?: boolean;
  },
): CustomerOfferResponse {
  hydrateCustomerOfferResponses();

  const now = formatResponseDateTime(new Date());
  const existing = responsesByRequestId.get(requestId);
  const items = options?.items ?? existing?.items ?? [];

  const closed: CustomerOfferResponse = {
    requestId,
    respondedAt: existing?.respondedAt ?? now,
    fedexUpgradeSelected:
      options?.fedexUpgradeSelected ?? existing?.fedexUpgradeSelected ?? false,
    fedexUpgradePrice:
      options?.fedexUpgradePrice ?? existing?.fedexUpgradePrice ?? 15,
    hasAcceptedPurchasableItems:
      options?.hasAcceptedPurchasableItems ??
      existing?.hasAcceptedPurchasableItems ??
      hasAcceptedPurchasableItems(items),
    items,
    closedAt: now,
  };

  responsesByRequestId.set(requestId, closed);
  persistCustomerOfferResponses();
  setRequestStatus(requestId, "Closed");

  return closed;
}

export function resetCustomerOfferResponses(): void {
  responsesByRequestId.clear();

  if (isBrowser()) {
    localStorage.removeItem(CUSTOMER_OFFER_RESPONSES_STORAGE_KEY);
    notifyLocalStateChanged();
  }
}
