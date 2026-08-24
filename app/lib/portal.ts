import {
  isGrowersChoice,
  linkedStockShortfall,
  resolveFulfillmentType,
  resolveLinkedWeightLbs,
  FULFILLMENT_TYPE_LABELS,
  type FulfillmentType,
} from "./growers-choice";

export type RequestStatus = "New" | "Pending" | "Closed" | "Expired";

export type OfferExpirationDays = 3 | 5 | 7;

export type ItemAvailabilityStatus = "available" | "not_available";

export type UnavailableReason =
  | "currently not in UPT prop circulation"
  | "available in 2+ mos"
  | "available in 2-3weeks"
  | "not in our current inventory";

export const UNAVAILABLE_REASON_OPTIONS: UnavailableReason[] = [
  "currently not in UPT prop circulation",
  "available in 2+ mos",
  "available in 2-3weeks",
  "not in our current inventory",
];

const LEGACY_UNAVAILABLE_REASONS: Record<string, UnavailableReason> = {
  "Currently not in UPT prop circulation":
    "currently not in UPT prop circulation",
  "currently not in UPT prop circulation":
    "currently not in UPT prop circulation",
  "Available in 2+ mos": "available in 2+ mos",
  "available in 2+ mos": "available in 2+ mos",
  "Available in 2-3 weeks": "available in 2-3weeks",
  "available in 2-3 weeks": "available in 2-3weeks",
  "available in 2-3weeks": "available in 2-3weeks",
  "Not in UPT's current inventory": "not in our current inventory",
  "not in our current inventory": "not in our current inventory",
  "Not in UPT's current inventory ": "not in our current inventory",
};

export const DEFAULT_UNAVAILABLE_REASON: UnavailableReason =
  "not in our current inventory";

export type PlantItemStatus =
  | "Requested"
  | "Sourced"
  | "Offered"
  | "Sold"
  | "Unavailable"
  | "Listed";

export type CustomerResponseItemChoice = "accept" | "reject" | "unavailable";

export type SentOffer = {
  offerLink: string;
  sentAt: string;
  sentAtIso: string;
  expiresAt: string;
  expiresAtIso: string;
  expirationDays: OfferExpirationDays;
  /** Set when the admin overrode draft-order shipping at send time. */
  shippingFeeOverride?: number;
};

/**
 * The store listing a Grower's Choice line draws on. Undefined on an exact
 * plant, which has no product in Shopify until it is listed as a declined item.
 */
export type LinkedStockSnapshot = {
  productGid: string;
  productTitle: string;
  productHandle?: string;
  variantGid: string;
  variantTitle: string;
  sku?: string;
  variantPrice?: number;
  variantWeightLbs?: number;
  inventoryQuantity?: number;
  inventoryTracked: boolean;
  imageUrl?: string;
  linkedAt?: string;
};

export type PlantItem = {
  id: string;
  plantName: string;
  offeredName: string;
  quantity: number;
  itemStatus: PlantItemStatus;
  availability: ItemAvailabilityStatus;
  unavailableReason: UnavailableReason;
  /** Which of the three routes this plant is on. See `growers-choice.ts`. */
  fulfillmentType: FulfillmentType;
  linkedStock?: LinkedStockSnapshot;
  /** Set when the linked stock ran out after the customer accepted. */
  fulfillmentIssue?: string;
  price: number;
  weightLbs: number;
  budget?: string;
  customerRequestNotes?: string;
  adminNotes: string;
  customerFacingNotes: string;
  photoPreviewUrl: string;
  photoUrls: string[];
  /** Stored photos with their ids, so the admin can remove and reorder them. */
  photos: Array<{ id: string; url: string }>;
};

export type PlantRequest = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  shopifyCustomerId?: string;
  status: RequestStatus;
  submittedDate: string;
  submittedAtIso: string;
  closedAt?: string;
  closedAtIso?: string;
  expiredAt?: string;
  expiredAtIso?: string;
  paidAt?: string;
  paidAtIso?: string;
  items: PlantItem[];
  sentOffer?: SentOffer;
  /** Undefined until an offer has been sent. See `offerHasPayableItems`. */
  hasPayableItems?: boolean;
  /** Whether the customer has answered the offer. */
  hasResponded: boolean;
  /** True when the customer said they already have an order with UPT. */
  hasExistingOrder?: boolean | null;
};

export type CustomerMyRequestRow = {
  id: string;
  requestNumber: string;
  submittedDate: string;
  plantsRequested: string;
  status: RequestStatus;
  /** Undefined until an offer has been sent. */
  hasPayableItems?: boolean;
  hasResponded: boolean;
};

export type CustomerResponseItem = {
  offerItemId: string;
  sourceItemId: string;
  plantName: string;
  choice: CustomerResponseItemChoice;
  price: number;
  quantity: number;
  lineRevenue: number;
  customerNotes: string;
  photoUrls: string[];
  unavailableReason?: string;
  /**
   * Copied from the offer, never re-read from the request item. The answer is a
   * record of what the customer was shown, so a later relink or rename in
   * Shopify must not rewrite it.
   */
  fulfillmentType: FulfillmentType;
  linkedProductTitle?: string;
  linkedVariantTitle?: string;
  /** The variant this line is billed against and reserved from. */
  linkedVariantGid?: string;
  linkedImageUrl?: string;
};

export type CustomerOfferResponse = {
  requestId: string;
  requestNumber: string;
  customerName: string;
  customerEmail: string;
  shopifyCustomerId?: string;
  respondedAt: string;
  respondedAtIso: string;
  offerExpiresAt?: string;
  fedexUpgradeSelected: boolean;
  fedexUpgradePrice: number;
  hasAcceptedPurchasableItems: boolean;
  items: CustomerResponseItem[];
  closedAt?: string;
};

export type DraftOrderSummary = {
  invoiceUrl?: string;
  shopifyDraftOrderGid?: string;
  createdAt: string;
};

export const DEFAULT_FEDEX_REMOVAL_WARNING =
  "Removing the FedEx Priority Overnight upgrade means this order will ship via standard USPS Priority. UPT only covers orders upgraded to FedEx Priority Overnight. Orders without this upgrade are not covered for carrier delays, weather damage, transit damage, lost packages, or other shipping-related issues.";

export const FEDEX_PRODUCT_HANDLE =
  "upgrade-to-fedex-priority-overnight-for-just-15-extra";

/** Live UPT listing. Draft-order lines resolve this SKU first. */
export const FEDEX_PRODUCT_SKU = "UPTUPGTOFED1236S";

export const FEDEX_PRODUCT_URL =
  "https://unsolicitedplanttalks.com/products/upgrade-to-fedex-priority-overnight-for-just-15-extra";

export function fedexVariantSkuQuery(sku = FEDEX_PRODUCT_SKU): string {
  return `sku:${sku}`;
}

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

export const NEEDS_PAYMENT_LABEL = "Needs Payment";

export const NOTHING_TO_PAY_LABEL = "No Payment Needed";

export const OFFER_READY_LABEL = "Offer Ready for Review";

/**
 * Pending is stored from the moment the offer is sent and nothing revises it,
 * so the label — not the status — is what has to tell a customer where they
 * stand: an offer waiting to be read, money owed on what they accepted, or
 * nothing to pay because they declined it all or nothing was available.
 *
 * With neither flag supplied the label never claims money is owed. A request
 * only reaches Pending by having an offer, so a caller that knows nothing about
 * the answer cannot know a payment is outstanding either.
 */
export function formatCustomerStatusLabel(
  status: RequestStatus,
  options: { hasPayableItems?: boolean; hasResponded?: boolean } = {},
): string {
  if (status === "Pending") {
    if (options.hasPayableItems === false) return NOTHING_TO_PAY_LABEL;
    return options.hasResponded ? NEEDS_PAYMENT_LABEL : OFFER_READY_LABEL;
  }
  return status;
}

/**
 * Whether anything on a sent offer can still be paid for.
 *
 * The offer freezes which plants were purchasable and the answer decides how
 * many of those the customer wanted, so an offer with nothing available and an
 * answer that rejected everything are both unpayable. An unanswered offer still
 * is: the customer can accept until the hold ends.
 */
export function offerHasPayableItems(input: {
  offerItems: Array<{ availability: string }>;
  responseChoices?: string[] | null;
}): boolean {
  const purchasable = input.offerItems.some(
    (item) => item.availability === "available",
  );
  if (!purchasable) return false;
  if (!input.responseChoices) return true;
  return input.responseChoices.includes("accept");
}

/**
 * What a plant must carry before it can be offered.
 *
 * Customer-facing notes are deliberately absent: they are editorial and often
 * there is nothing to disclose. Everything here is something the customer is
 * asked to buy on — the plant they are looking at, the amount they will be
 * billed, and the weight the draft order ships on.
 *
 * Which of these apply depends on the fulfilment route. An exact plant needs a
 * photograph of the individual being sold; a Grower's Choice plant is sold from
 * a listing that already has its own photo, and needs a variant that can still
 * be bought instead.
 */
export const OFFER_ITEM_REQUIREMENTS = [
  "an exact plant photo",
  "a linked store listing",
  "enough stock on the linked listing",
  "a price",
  "a weight",
] as const;

export type OfferItemRequirement = (typeof OFFER_ITEM_REQUIREMENTS)[number];

export type IncompleteOfferItem = {
  itemName: string;
  missing: OfferItemRequirement[];
};

type OfferReadinessItem = {
  plantName: string;
  offeredName?: string | null;
  availability: string;
  fulfillmentType?: string | null;
  price: number;
  weightLbs: number;
  quantity?: number;
  photos: unknown[];
  linkedStock?: LinkedStockSnapshot;
};

/**
 * The items that cannot be offered yet, and what each one is missing.
 *
 * Not Available items are excluded: UPT is supplying nothing, so there is
 * nothing to photograph, link, price or weigh.
 */
export function incompleteOfferItems(
  items: OfferReadinessItem[],
): IncompleteOfferItem[] {
  const problems: IncompleteOfferItem[] = [];

  for (const item of items) {
    const fulfillment = resolveFulfillmentType(item);
    if (fulfillment === "not_available") continue;

    const missing: OfferItemRequirement[] = [];

    if (fulfillment === "growers_choice") {
      if (!item.linkedStock?.variantGid.trim()) {
        // Naming the stock as well would be two complaints about one gap.
        missing.push("a linked store listing");
      } else if (
        linkedStockShortfall({
          inventoryTracked: item.linkedStock.inventoryTracked,
          inventoryQuantity: item.linkedStock.inventoryQuantity,
          quantity: item.quantity ?? 1,
        }) > 0
      ) {
        missing.push("enough stock on the linked listing");
      }
    } else if (item.photos.length === 0) {
      missing.push("an exact plant photo");
    }

    if (!(normalizePrice(item.price) > 0)) missing.push("a price");

    const weightLbs =
      fulfillment === "growers_choice"
        ? resolveLinkedWeightLbs({
            linkedVariantWeightLbs: item.linkedStock?.variantWeightLbs,
            weightLbs: item.weightLbs,
          })
        : item.weightLbs;
    if (!(normalizeWeight(weightLbs) > 0)) missing.push("a weight");

    if (missing.length === 0) continue;

    problems.push({
      itemName: item.offeredName?.trim() || item.plantName,
      missing,
    });
  }

  return problems;
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * Names every item that is not ready and the fields it lacks.
 *
 * "Fill in the form" is useless on a request with six plants: the merchant has
 * to be told which plant and which field, or they go looking.
 */
export function offerReadinessMessage(problems: IncompleteOfferItem[]): string {
  if (problems.length === 0) return "";
  const sentences = problems.map(
    (problem) => `${problem.itemName} is missing ${joinWithAnd(problem.missing)}.`,
  );
  return `This offer cannot be sent yet. ${sentences.join(" ")}`;
}

export function normalizeUnavailableReason(
  reason?: string | null,
): UnavailableReason {
  if (!reason) return DEFAULT_UNAVAILABLE_REASON;
  return LEGACY_UNAVAILABLE_REASONS[reason] ?? DEFAULT_UNAVAILABLE_REASON;
}

export const GLOBAL_REQUEST_SEQUENCE_YEAR = 0;

export function formatRequestNumber(value: number): string {
  const n = Math.max(1, Math.floor(value));
  return `REQ${n}`;
}

export function parseRequestNumber(raw?: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const modern = trimmed.match(/^REQ(\d+)$/i);
  if (modern) {
    const value = Number.parseInt(modern[1], 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const legacy = trimmed.match(/^UPT-REQ-\d{4}-(\d+)$/i);
  if (legacy) {
    const value = Number.parseInt(legacy[1], 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  return null;
}

export function getDisplayRequestNumber(request: {
  id: string;
  requestNumber?: string;
}): string {
  if (request.requestNumber) {
    const parsed = parseRequestNumber(request.requestNumber);
    if (parsed != null) return formatRequestNumber(parsed);
    return request.requestNumber;
  }
  return "REQ";
}

export function formatPlantsSummary(
  items: Array<{ plantName: string }>,
): string {
  return items.map((item) => item.plantName).join(", ");
}

export function requestStatusTone(
  status: RequestStatus,
): "info" | "warning" | "caution" | "success" | "critical" {
  switch (status) {
    case "New":
      return "info";
    case "Pending":
      return "caution";
    case "Closed":
      return "success";
    case "Expired":
      return "critical";
  }
}

/**
 * Tone for the derived customer label. Stored Pending stays Pending; this only
 * changes how the three customer-facing labels read.
 */
export function customerStatusTone(
  status: RequestStatus,
  options: { hasPayableItems?: boolean; hasResponded?: boolean } = {},
): "info" | "warning" | "caution" | "success" | "critical" {
  if (status === "Pending") {
    const label = formatCustomerStatusLabel(status, options);
    if (label === NOTHING_TO_PAY_LABEL) return "info";
    if (label === NEEDS_PAYMENT_LABEL) return "warning";
    return "caution";
  }
  return requestStatusTone(status);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function normalizePrice(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeWeight(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10) / 10;
}

export function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export function matchesAdminSearch(
  request: {
    customer: string;
    email?: string;
    requestNumber: string;
    items: Array<{ plantName: string; offeredName?: string }>;
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystacks = [
    request.customer,
    request.email ?? "",
    request.requestNumber,
    getDisplayRequestNumber({
      id: "",
      requestNumber: request.requestNumber,
    }),
    ...request.items.map((item) => item.plantName),
    ...request.items.map((item) => item.offeredName ?? ""),
  ];

  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

export function matchesAnalyticsCustomerSearch(
  query: string,
  customer: { customerName: string; email: string },
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    customer.customerName.toLowerCase().includes(needle) ||
    customer.email.toLowerCase().includes(needle)
  );
}

export const ADMIN_DASHBOARD_STATUS_FILTERS = [
  "All",
  "New",
  "Pending",
  "Expired",
  "Closed",
  "ExistingOrder",
] as const;

export type AdminDashboardStatusFilter =
  (typeof ADMIN_DASHBOARD_STATUS_FILTERS)[number];

export function adminDashboardFilterLabel(
  filter: AdminDashboardStatusFilter,
): string {
  return filter === "ExistingOrder" ? "Existing order" : filter;
}

export function parseAdminDashboardStatusFilter(
  value: string | null | undefined,
): AdminDashboardStatusFilter {
  if (
    value &&
    (ADMIN_DASHBOARD_STATUS_FILTERS as readonly string[]).includes(value)
  ) {
    return value as AdminDashboardStatusFilter;
  }
  return "All";
}

export function matchesAdminStatusFilter(
  status: RequestStatus,
  filter: AdminDashboardStatusFilter,
  hasExistingOrder?: boolean | null,
): boolean {
  if (filter === "ExistingOrder") {
    return status === "New" && hasExistingOrder === true;
  }
  return filter === "All" || status === filter;
}

export function filterAdminDashboardRequests<
  T extends {
    status: RequestStatus;
    customer: string;
    email?: string;
    requestNumber: string;
    items: Array<{ plantName: string; offeredName?: string }>;
    hasExistingOrder?: boolean | null;
  },
>(requests: T[], query: string, statusFilter: AdminDashboardStatusFilter): T[] {
  return requests.filter(
    (request) =>
      matchesAdminStatusFilter(
        request.status,
        statusFilter,
        request.hasExistingOrder,
      ) && matchesAdminSearch(request, query),
  );
}

export function summarizeAdminDashboardStats(
  requests: Array<{ status: RequestStatus }>,
) {
  return {
    newRequests: requests.filter((request) => request.status === "New").length,
    pending: requests.filter((request) => request.status === "Pending").length,
    closed: requests.filter((request) => request.status === "Closed").length,
    expired: requests.filter((request) => request.status === "Expired").length,
  };
}

export function countAdminDashboardStatusFilters(
  requests: Array<{ status: RequestStatus; hasExistingOrder?: boolean | null }>,
): Record<AdminDashboardStatusFilter, number> {
  const stats = summarizeAdminDashboardStats(requests);
  return {
    All: requests.length,
    New: stats.newRequests,
    Pending: stats.pending,
    Expired: stats.expired,
    Closed: stats.closed,
    ExistingOrder: requests.filter(
      (request) => request.status === "New" && request.hasExistingOrder === true,
    ).length,
  };
}

/**
 * Blank means Shopify quotes shipping. A parsed number (including 0) is a
 * custom shipping line on the later draft order.
 */
export function parseShippingFeeOverride(
  raw: unknown,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const text = String(raw).trim();
  if (text === "") return { ok: true };
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "Shipping override must be a number of 0 or more." };
  }
  return { ok: true, value: normalizePrice(value) };
}

/**
 * Names what is on offer without promising an exact plant that is not one.
 *
 * A Grower's Choice line is picked from stock at dispatch, so calling it an
 * exact plant beside a listing photo reads as the promise the disclosure right
 * under it takes back.
 */
function offeredPlantsSubject(allExactPlants: boolean): string {
  return allExactPlants ? "These exact plants" : "These plants";
}

export function getOfferHoldMessage(expiresAt: string, allExactPlants = true): string {
  return `${offeredPlantsSubject(
    allExactPlants,
  )} are being held for you until ${expiresAt}. After that, this offer may be released.`;
}

export function getOfferUrgencyMessage(allExactPlants = true): string {
  return `${offeredPlantsSubject(
    allExactPlants,
  )} are reserved for you. Review and respond before this offer expires.`;
}

/** True when no offered line is supplied from stock the store already lists. */
export function offerIsAllExactPlants(
  items: Array<{ availability: string | null | undefined; fulfillmentType?: string | null }>,
): boolean {
  return !items.some((item) => isGrowersChoice(item));
}

export function computeTimeRemaining(expiresAtIso: string, now = new Date()): string | null {
  const expiresAt = new Date(expiresAtIso);
  const ms = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Expired";

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"} remaining`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
}

export function isOfferExpired(expiresAtIso: string, now = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}

export function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Internal admin labels. None of these is ever rendered on a customer-facing
 * page: they exist so the owner can read a customer's history, not to gate
 * anything the customer can do.
 */
export type BehaviorFlag =
  | "Good Customer"
  | "Strong Buyer"
  | "Partial Buyer"
  | "Repeated Request / Decline Pattern"
  | "High Request / Low Purchase"
  | "Approval Drop-Off"
  | "Expired Offer Risk"
  | "No Purchase"
  | "New Customer";

export type CustomerBehaviorMetrics = {
  totalRequests: number;
  offersSent: number;
  itemsRequested: number;
  itemsOffered: number;
  itemsAccepted: number;
  itemsPurchased: number;
  closedPaidRequests: number;
  expiredRequests: number;
  totalRevenue: number;
  /**
   * Canonical plants this customer has repeatedly asked for and repeatedly turned
   * down. Counted in `plant-behavior.server.ts`, which needs the plant identities
   * these totals have already been summed across.
   */
  repeatedRequestDeclinePlants?: number;
};

export function computeNoPaymentRate(
  totalRequests: number,
  closedPaidRequests: number,
): number {
  if (totalRequests === 0) return 0;
  return percent(totalRequests - closedPaidRequests, totalRequests);
}

export function computeBehaviorFlags(
  metrics: CustomerBehaviorMetrics,
): BehaviorFlag[] {
  const flags: BehaviorFlag[] = [];
  const requestToPurchase =
    metrics.itemsRequested === 0
      ? 0
      : metrics.itemsPurchased / metrics.itemsRequested;
  const acceptedToPurchased =
    metrics.itemsAccepted === 0
      ? 0
      : metrics.itemsPurchased / metrics.itemsAccepted;

  if ((metrics.repeatedRequestDeclinePlants ?? 0) > 0) {
    flags.push("Repeated Request / Decline Pattern");
  }

  if (metrics.itemsAccepted > 0 && metrics.itemsPurchased === 0) {
    flags.push("Approval Drop-Off");
  }

  if (metrics.itemsRequested >= 5 && requestToPurchase < 0.4) {
    flags.push("High Request / Low Purchase");
  }

  if (metrics.expiredRequests > 0 && metrics.closedPaidRequests === 0) {
    flags.push("Expired Offer Risk");
  }

  if (metrics.itemsAccepted > 0 && acceptedToPurchased >= 0.75) {
    flags.push("Strong Buyer");
  } else if (metrics.itemsPurchased > 0 && metrics.itemsAccepted > 0) {
    flags.push("Partial Buyer");
  }

  if (metrics.closedPaidRequests > 0) {
    flags.push("Good Customer");
  }

  if (metrics.itemsPurchased === 0 && metrics.totalRequests > 0) {
    flags.push("No Purchase");
  }

  if (metrics.totalRequests <= 1 && metrics.closedPaidRequests === 0) {
    flags.push("New Customer");
  }

  if (flags.length === 0) {
    flags.push("New Customer");
  }

  return uniqueFlags(flags);
}

export function primaryBehaviorFlag(flags: BehaviorFlag[]): BehaviorFlag {
  const priority: BehaviorFlag[] = [
    // First because it is the most specific thing known about the customer: it
    // names a plant, whereas everything below it is a ratio.
    "Repeated Request / Decline Pattern",
    "Approval Drop-Off",
    "High Request / Low Purchase",
    "Expired Offer Risk",
    "Strong Buyer",
    "Partial Buyer",
    "Good Customer",
    "No Purchase",
    "New Customer",
  ];

  return priority.find((flag) => flags.includes(flag)) ?? "New Customer";
}

function uniqueFlags(flags: BehaviorFlag[]): BehaviorFlag[] {
  return [...new Set(flags)];
}

export function behaviorFlagTone(
  flag: BehaviorFlag,
): "success" | "warning" | "info" | "critical" | "caution" {
  switch (flag) {
    case "Good Customer":
    case "Strong Buyer":
      return "success";
    case "Partial Buyer":
      return "info";
    case "High Request / Low Purchase":
    case "Repeated Request / Decline Pattern":
      return "warning";
    case "Approval Drop-Off":
    case "Expired Offer Risk":
      return "critical";
    case "No Purchase":
      return "caution";
    case "New Customer":
      return "info";
  }
}

export type DraftOrderLineItem = {
  title: string;
  quantity: number;
  price: number;
  weightLbs: number;
  kind: "plant" | "fedex";
  /**
   * The real Shopify variant this line sells. Present on a Grower's Choice
   * plant, which comes out of stock the store already lists, and on the FedEx
   * upgrade. An exact plant has no product in Shopify yet, so its line is a
   * custom one and carries no variant.
   */
  variantId?: string;
};

export type AcceptedDraftOrderItem = {
  /** The request item, so a stock failure can be reported against one plant. */
  itemId: string;
  plantName: string;
  quantity: number;
  price: number;
  weightLbs: number;
  /** Set for a Grower's Choice plant, from the frozen offer snapshot. */
  variantId?: string;
};

export function buildDraftOrderLineItems(input: {
  acceptedItems: AcceptedDraftOrderItem[];
  fedexSelected: boolean;
  fedexLabel: string;
  fedexPrice: number;
  fedexVariantGid?: string;
}): DraftOrderLineItem[] {
  const lines: DraftOrderLineItem[] = input.acceptedItems.map((item) => ({
    title: item.plantName,
    quantity: normalizeQuantity(item.quantity),
    price: normalizePrice(item.price),
    weightLbs: normalizeWeight(item.weightLbs),
    kind: "plant",
    ...(item.variantId ? { variantId: item.variantId } : {}),
  }));

  if (input.fedexSelected && lines.length > 0) {
    lines.push({
      title: input.fedexLabel,
      quantity: 1,
      price: normalizePrice(input.fedexPrice),
      weightLbs: 0,
      kind: "fedex",
      ...(input.fedexVariantGid ? { variantId: input.fedexVariantGid } : {}),
    });
  }

  return lines;
}

/** Every line that sells a real Shopify variant, so it can be verified first. */
export function variantBackedLines(
  lines: DraftOrderLineItem[],
): Array<DraftOrderLineItem & { variantId: string }> {
  return lines.flatMap((line) =>
    line.variantId ? [{ ...line, variantId: line.variantId }] : [],
  );
}

/**
 * When Shopify should let reserved stock go again, or undefined for a draft
 * order that reserves nothing.
 *
 * The deadline is the customer's own payment deadline — the end of the hold the
 * offer already promised them — so the stock is held for exactly as long as
 * they were told and comes back the moment that lapses. Shopify releases it
 * itself, which is what makes the release survive a portal that is down.
 *
 * Nothing is reserved unless a plant line actually sells store stock: asking to
 * reserve on an all-exact-plant order would newly hold the FedEx upgrade
 * variant, which is a shipping service and has never been held for anyone. A
 * deadline that has already passed is dropped rather than sent, because
 * Shopify will not reserve into the past and the admin's recovery path can run
 * after the hold has ended.
 */
export function reserveInventoryUntilFor(input: {
  lineItems: DraftOrderLineItem[];
  holdEndsAt?: Date | string | null;
  now?: Date;
}): string | undefined {
  const holdsStock = input.lineItems.some(
    (line) => line.kind === "plant" && line.variantId,
  );
  if (!holdsStock || !input.holdEndsAt) return undefined;

  const deadline = new Date(input.holdEndsAt);
  if (!Number.isFinite(deadline.getTime())) return undefined;
  if (deadline.getTime() <= (input.now ?? new Date()).getTime()) return undefined;
  return deadline.toISOString();
}

/** Tag the `orders/paid` webhook matches a paid order back to its request by. */
export const DRAFT_ORDER_TAG = "upt-plant-request";

/**
 * Tag that identifies the one draft order belonging to a request.
 *
 * Lets a retry find a draft order Shopify already created when the reply to
 * `draftOrderCreate` never arrived, instead of creating a second one and
 * billing the customer twice.
 */
export function draftOrderIdempotencyTag(requestId: string): string {
  return `upt-request:${requestId}`;
}

/**
 * A Shopify search query matching one exact tag.
 *
 * The quotes are load-bearing. Every idempotency tag the portal writes contains
 * a colon, which Shopify's search syntax reads as a field/value separator, so
 * an unquoted `tag:upt-declined-item:abc` searches for the tag
 * `upt-declined-item` plus a loose term — matching a different plant's product
 * and applying this plant's title and price to it.
 */
export function tagSearchQuery(tag: string): string {
  return `tag:'${tag}'`;
}

/**
 * Variables for `draftOrderCreate`. Kept pure and separate from the API call so
 * `scripts/validate-admin-graphql.mjs` can check the payload against the real
 * `DraftOrderInput` type — a document can be valid while its variables use a
 * field Shopify has since removed.
 */
export function buildDraftOrderInput(input: {
  requestId: string;
  requestNumber: string;
  customerEmail: string;
  currencyCode: string;
  lineItems: DraftOrderLineItem[];
  /** ISO 8601 instant from `reserveInventoryUntilFor`. */
  reserveInventoryUntil?: string;
  /**
   * Custom shipping line. Omitted when undefined so Shopify quotes a rate.
   * 0 is a real override (no shipping charge).
   */
  shippingFeeOverride?: number;
}) {
  return {
    email: input.customerEmail,
    note: `UPT plant request ${input.requestNumber}`,
    tags: [
      DRAFT_ORDER_TAG,
      input.requestNumber,
      draftOrderIdempotencyTag(input.requestId),
    ],
    ...(input.shippingFeeOverride !== undefined
      ? {
          shippingLine: {
            title: "Shipping",
            priceWithCurrency: {
              amount: normalizePrice(input.shippingFeeOverride).toFixed(2),
              currencyCode: input.currencyCode,
            },
          },
        }
      : {}),
    // Shopify's own hold on the stock behind this order. It is the whole
    // reservation mechanism: nothing else in the app decrements or restores a
    // quantity, so there is no second copy of the truth to drift, and a retry
    // that recreates the same draft order asks for the same hold.
    ...(input.reserveInventoryUntil
      ? { reserveInventoryUntil: input.reserveInventoryUntil }
      : {}),
    lineItems: input.lineItems.map((line) => {
      // The real variant carries the weight, but not the price: the customer
      // was quoted, emailed and shown an amount when they answered the offer,
      // and Shopify must bill that rather than whatever the variant costs by
      // the time they open the invoice.
      const price = {
        originalUnitPriceWithCurrency: {
          amount: line.price.toFixed(2),
          currencyCode: input.currencyCode,
        },
      };

      if (line.variantId) {
        return {
          variantId: line.variantId,
          quantity: line.quantity,
          ...price,
          // The FedEx line is the shipping upgrade itself, so it stays
          // unshippable and weightless. A plant sold off the shelf ships like
          // any other plant, on the weight the offer froze — which is the
          // variant's own weight whenever Shopify holds one.
          ...(line.kind === "plant"
            ? {
                requiresShipping: true,
                ...(line.weightLbs > 0
                  ? { weight: { value: line.weightLbs, unit: "POUNDS" as const } }
                  : {}),
              }
            : {}),
        };
      }

      return {
        title: line.title,
        ...price,
        quantity: line.quantity,
        weight: { value: line.weightLbs, unit: "POUNDS" as const },
        // Shopify defaults a custom line item to requiresShipping: false, and a
        // draft order with nothing shippable collects no delivery address and
        // quotes no shipping. UPT ships live plants: without this the merchant
        // gets a paid order with a weight, a customer, and nowhere to send it.
        requiresShipping: line.kind === "plant",
      };
    }),
  };
}

export function plantRevenueFromLines(lines: DraftOrderLineItem[]): number {
  return lines
    .filter((line) => line.kind === "plant")
    .reduce((sum, line) => sum + line.price * line.quantity, 0);
}

/** The numeric part of a Shopify GID, or of an id that is already numeric. */
export function shopifyNumericId(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const digits = text.match(/(\d+)$/)?.[1];
  return digits ?? null;
}

export type PaidOrderLine = {
  title?: string | null;
  name?: string | null;
  price?: string | number | null;
  quantity?: number | null;
  variant_id?: string | number | null;
  admin_graphql_api_variant_id?: string | null;
};

export type FedexLineIdentity = {
  /** `ShopSettings.fedexVariantGid`: the variant the upgrade is billed on. */
  variantGid?: string | null;
  /** `ShopSettings.fedexUpgradeLabel`: the title the app gives a custom line. */
  upgradeLabel?: string | null;
  /** Whether the customer's frozen response kept the upgrade. */
  upgradeSelected?: boolean;
};

export type PaidOrderPlantRevenue = {
  plantRevenue: number;
  fedexLineCount: number;
  /**
   * True when the customer paid for the upgrade but no line could be identified
   * as it, so `plantRevenue` includes the shipping charge.
   */
  unidentifiedUpgrade: boolean;
};

function isFedexLine(line: PaidOrderLine, fedex: FedexLineIdentity): boolean {
  const variantId = shopifyNumericId(fedex.variantGid);
  if (variantId) {
    const lineVariantId =
      shopifyNumericId(line.admin_graphql_api_variant_id) ??
      shopifyNumericId(line.variant_id);
    if (lineVariantId) return lineVariantId === variantId;
  }

  const label = fedex.upgradeLabel?.trim().toLowerCase();
  if (!label) return false;
  const title = (line.title ?? line.name ?? "").trim().toLowerCase();
  return title === label;
}

/**
 * Plant revenue from a paid order's own line items. The fallback for a request
 * with no recorded draft order, where `plantRevenueFromLines` and its explicit
 * `kind` are unavailable.
 *
 * The upgrade is identified by the variant the app bills it on, and failing
 * that by the exact label the app gives the custom line — both values the app
 * wrote itself. Filtering on the substrings "fedex" and "priority overnight"
 * instead counted a renamed shipping line as a plant, and dropped a $300 plant
 * whose offered name happened to contain "Fedex".
 *
 * Nothing is excluded on a guess: an unrecognized line counts as a plant, so
 * the worst case over-states revenue by the shipping charge rather than losing
 * a plant, and `unidentifiedUpgrade` reports that it happened.
 */
export function plantRevenueFromPaidOrderLines(
  lines: PaidOrderLine[],
  fedex: FedexLineIdentity = {},
): PaidOrderPlantRevenue {
  let plantRevenue = 0;
  let fedexLineCount = 0;

  for (const line of lines) {
    if (isFedexLine(line, fedex)) {
      fedexLineCount += 1;
      continue;
    }
    const price = Number.parseFloat(String(line.price ?? "0"));
    const quantity = line.quantity ?? 1;
    plantRevenue += Number.isFinite(price) ? price * quantity : 0;
  }

  return {
    plantRevenue: normalizePrice(plantRevenue),
    fedexLineCount,
    unidentifiedUpgrade: Boolean(fedex.upgradeSelected) && fedexLineCount === 0,
  };
}

export type ResponseSummaryItem = {
  plantName: string;
  price: number;
  customerNotes: string;
  /** Defaults to the exact plant, which is what every earlier offer was. */
  fulfillmentType?: FulfillmentType;
};

export type ResponseSummaryEmailInput = {
  customerName: string;
  requestNumber: string;
  acceptedItems: ResponseSummaryItem[];
  rejectedItems: ResponseSummaryItem[];
  fedexSelected: boolean;
  fedexPrice: number;
  fedexDisclaimer?: string;
  invoiceUrl?: string;
  /** When the accepted plants stop being held. Omitted when nothing is held. */
  expiresAt?: string;
};

function responseSummaryLines(items: ResponseSummaryItem[]): string[] {
  return items.map((item) => {
    const notes = item.customerNotes.trim()
      ? ` Notes: ${item.customerNotes.trim()}`
      : "";
    // Named only for Grower's Choice. An exact plant is what the offer has
    // always meant, so labelling it would read as a new distinction on every
    // line of every email.
    const route =
      item.fulfillmentType === "growers_choice"
        ? ` (${FULFILLMENT_TYPE_LABELS.growers_choice})`
        : "";
    return `- ${item.plantName}${route} — ${formatCurrency(item.price)}${notes}`;
  });
}

/**
 * Spelled out once, under the item list, rather than on every line: the label
 * beside the plant says which route it is on, and this says what the route
 * means for the plant that turns up.
 */
function growersChoiceEmailNote(items: ResponseSummaryItem[]): string[] {
  const named = items.some((item) => item.fulfillmentType === "growers_choice");
  if (!named) return [];
  return [
    "",
    "Grower's Choice means we choose a healthy plant of that kind from our existing website stock for you, rather than the specific plant in the listing photo.",
  ];
}

/**
 * The one email a customer gets for the choices they submitted.
 *
 * It replaced a confirmation and a separate payment-link message, which meant
 * two emails for one action and a checkout link the confirmation had already
 * carried. Everything the customer needs to know about their answer is here,
 * including the plants they turned down, so the mail is also the record.
 */
export function buildResponseSummaryEmail(
  input: ResponseSummaryEmailInput,
): { subject: string; bodyText: string } {
  const accepted = input.acceptedItems.length > 0;
  const lines = [`Hi ${input.customerName || "there"},`, ""];

  if (accepted) {
    lines.push(`Your UPT plant offer selections for ${input.requestNumber} are confirmed.`);
    lines.push("");
    lines.push("Accepted:");
    lines.push(...responseSummaryLines(input.acceptedItems));
  } else {
    lines.push(`Thank you for answering your UPT plant offer ${input.requestNumber}.`);
    lines.push("");
    // The customer declined everything, so the first thing to settle is that
    // nobody is waiting on money from them.
    lines.push(
      "You did not accept any plants from this offer, so no payment is needed and there is nothing left to pay.",
    );
  }

  if (input.rejectedItems.length > 0) {
    lines.push("");
    lines.push(accepted ? "Declined:" : "Plants you declined:");
    lines.push(...responseSummaryLines(input.rejectedItems));
  }

  lines.push(
    ...growersChoiceEmailNote([...input.acceptedItems, ...input.rejectedItems]),
  );

  // The upgrade only ever ships plants. With nothing accepted there is no
  // shipment, no charge and nothing to disclaim.
  if (accepted) {
    lines.push("");
    if (input.fedexSelected) {
      lines.push(
        `FedEx Priority Overnight Upgrade: kept (${formatCurrency(input.fedexPrice)})`,
      );
    } else {
      lines.push("FedEx Priority Overnight Upgrade: removed");
      if (input.fedexDisclaimer) {
        lines.push("");
        lines.push(input.fedexDisclaimer);
      }
    }

    if (input.invoiceUrl) {
      lines.push("");
      lines.push("Complete your payment:");
      lines.push(input.invoiceUrl);
      lines.push("");
      lines.push(
        `Need help with this invoice or need something changed? Email ${CUSTOMER_SUPPORT_EMAIL}. Otherwise, you can follow your request status in the portal.`,
      );
    }

    if (input.expiresAt) {
      lines.push("");
      lines.push(
        `These plants are held for you until ${input.expiresAt}. After that, this offer may be released.`,
      );
    }
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push("Unsolicited Plant Talks");

  return {
    subject: accepted
      ? `Your UPT plant offer confirmation (${input.requestNumber})`
      : `We received your response — no payment needed (${input.requestNumber})`,
    bodyText: lines.join("\n"),
  };
}

/**
 * The one message UPT gets when a customer answers an offer.
 *
 * Deliberately per response rather than per item: a six-plant offer used to be
 * worth six notifications, which is how a mailbox stops being read.
 */
export function buildAdminResponseEmail(input: {
  requestNumber: string;
  customerName: string;
  customerEmail: string;
  acceptedCount: number;
  rejectedCount: number;
}): { subject: string; bodyText: string } {
  const accepted = input.acceptedCount > 0;
  const summary = accepted
    ? `${input.acceptedCount} of ${input.acceptedCount + input.rejectedCount} item(s) accepted`
    : "every item declined";

  return {
    subject: `${input.requestNumber}: customer responded (${summary})`,
    bodyText: [
      `${input.customerName} <${input.customerEmail}> answered the offer on ${input.requestNumber}.`,
      "",
      accepted
        ? `Accepted: ${input.acceptedCount} item(s). Declined: ${input.rejectedCount} item(s).`
        : `The customer declined all ${input.rejectedCount} item(s). Nothing is owed and no draft order was created.`,
    ].join("\n"),
  };
}

export function buildRequestReceivedEmail(input: {
  customerName: string;
  requestNumber: string;
  plantNames: string[];
}): { subject: string; bodyText: string } {
  return {
    subject: `We received plant request ${input.requestNumber}`,
    bodyText: [
      `Hi ${input.customerName || "there"},`,
      "",
      `We received your plant request ${input.requestNumber}.`,
      "",
      "Requested plants:",
      ...input.plantNames.map((name) => `- ${name}`),
      "",
      "We'll notify you when your personal offer is ready.",
      "",
      "Thank you,",
      "Unsolicited Plant Talks",
    ].join("\n"),
  };
}

/** The invoice Shopify issued is gone; money must still be recorded. */
export const PAYMENT_AFTER_VOID_REASON = "Payment After Expiration/Void";

/** The sweep successfully made an expired unpaid invoice non-payable. */
export const INVOICE_VOIDED_REASON = "Invoice voided after expiration";

/** Admin ended a request that had not reached Closed on its own. */
export const ADMIN_OVERRIDE_CLOSE_REASON = "Admin Override Close";

/** The unpaid invoice was deleted because an admin override closed the request. */
export const INVOICE_VOIDED_BY_ADMIN_REASON =
  "Invoice voided after admin override close";

/** The customer closed a No Payment Needed request after declining everything. */
export const CUSTOMER_CLOSED_REQUEST_REASON = "Customer Closed Request";

/** A leftover payable invoice was deleted because the customer closed the request. */
export const INVOICE_VOIDED_BY_CUSTOMER_CLOSE_REASON =
  "Invoice voided after customer closed request";

export const CUSTOMER_SUPPORT_EMAIL = "support@unsolicitedplanttalks.com";

/** New and Pending are still waiting; Closed and Expired are historical. */
export function showCustomerSupportNote(status: RequestStatus): boolean {
  return status === "New" || status === "Pending";
}

export function shopifyAdminDraftOrderUrl(
  shop: string,
  draftOrderGid: string | null | undefined,
): string | undefined {
  if (!draftOrderGid) return undefined;
  const store = shop.replace(/\.myshopify\.com$/i, "");
  const numericId = draftOrderGid.split("/").pop();
  if (!numericId) return undefined;
  return `https://admin.shopify.com/store/${store}/draft_orders/${numericId}`;
}

/**
 * What the admin request page may show for this request's Draft Order.
 *
 * A voided/deleted invoice keeps its GID internally but must not be offered as
 * a live Shopify Admin link — that URL 404s after `draftOrderDelete`.
 */
export type AdminDraftOrderLinkState =
  | { kind: "live"; href: string }
  | { kind: "voided" }
  | { kind: "none" };

export function adminDraftOrderLinkState(input: {
  shop: string;
  shopifyDraftOrderGid?: string | null;
  voidedAt?: Date | string | null;
}): AdminDraftOrderLinkState {
  if (input.voidedAt) return { kind: "voided" };
  const href = shopifyAdminDraftOrderUrl(input.shop, input.shopifyDraftOrderGid);
  if (href) return { kind: "live", href };
  return { kind: "none" };
}

/** Active waiting states only. Closed and Expired are historical. */
export function shouldRenderCustomerSupportNote(input: {
  status?: RequestStatus | null;
  requestClosed?: boolean;
  offerExpired?: boolean;
}): boolean {
  if (input.requestClosed || input.offerExpired) return false;
  if (!input.status) return false;
  return showCustomerSupportNote(input.status);
}

/**
 * The checkout URL a customer may still be shown.
 *
 * After the hold ends the invoice must not be offered: Shopify will still
 * complete a stale draft order, and a Grower's Choice unit is back on open
 * sale. A voided row or a closed/paid request is the same rule.
 */
export function payableInvoiceUrl(input: {
  invoiceUrl?: string | null;
  voidedAt?: Date | string | null;
  requestClosed?: boolean;
  requestPaid?: boolean;
  expiresAtIso?: string | null;
  now?: Date;
}): string | null {
  if (input.requestClosed || input.requestPaid) return null;
  if (input.voidedAt) return null;
  if (input.expiresAtIso && isOfferExpired(input.expiresAtIso, input.now)) {
    return null;
  }
  return input.invoiceUrl ?? null;
}

/**
 * The admin recovery button is only for a live accepted request whose Shopify
 * draft never landed. An expired, voided, paid or closed request already has
 * no payable invoice on purpose — offering to mint one there looks like the
 * normal way invoices are sent.
 */
export function shouldOfferAdminPaymentLinkRecovery(input: {
  hasAcceptedItems: boolean;
  paymentLink?: string | null;
  requestStatus: RequestStatus;
  invoiceVoided?: boolean;
  requestPaid?: boolean;
}): boolean {
  if (!input.hasAcceptedItems) return false;
  if (input.paymentLink) return false;
  if (input.requestPaid) return false;
  if (input.invoiceVoided) return false;
  return input.requestStatus === "Pending";
}

export function buildAdminPaymentAfterVoidEmail(input: {
  requestNumber: string;
  orderNumber?: string;
}): { subject: string; bodyText: string } {
  const order = input.orderNumber ? ` (${input.orderNumber})` : "";
  return {
    subject: `URGENT: Payment after expiration on ${input.requestNumber}`,
    bodyText: [
      `A Shopify order${order} paid an invoice that this portal had already voided for ${input.requestNumber}.`,
      "",
      "The payment was recorded and the request is Closed so the money is not lost.",
      "The plant is no longer eligible for EXACT PLANTS listing.",
      "This is not a normal payment — check whether the same plant was already relisted or sold.",
    ].join("\n"),
  };
}

export function buildAdminNewRequestEmail(input: {
  requestNumber: string;
  customerName: string;
  customerEmail: string;
  plantNames: string[];
}): { subject: string; bodyText: string } {
  return {
    subject: `New plant request ${input.requestNumber}`,
    bodyText: [
      `New request ${input.requestNumber} from ${input.customerName} <${input.customerEmail}>.`,
      "",
      "Requested plants:",
      ...input.plantNames.map((name) => `- ${name}`),
    ].join("\n"),
  };
}

/**
 * Announces that UPT has answered the request, and nothing more.
 *
 * The customer has not seen the offer yet, so this must not talk about payment:
 * they may decline every plant, and telling them money is due before they have
 * read what is on offer is both wrong and a reason not to open it.
 */
export function buildOfferReadyEmail(input: {
  customerName: string;
  requestNumber: string;
  expiresAt: string;
  offerLink: string;
  allExactPlants?: boolean;
}): { subject: string; bodyText: string } {
  return {
    subject: `UPT has responded to your plant request (${input.requestNumber})`,
    bodyText: [
      `Hi ${input.customerName || "there"},`,
      "",
      `UPT has responded to your plant request ${input.requestNumber}. Your personal offer is ready to review, and you decide which plants you want.`,
      getOfferHoldMessage(input.expiresAt, input.allExactPlants ?? true),
      "",
      "Review your offer:",
      input.offerLink,
      "",
      "Thank you,",
      "Unsolicited Plant Talks",
    ].join("\n"),
  };
}

export function buildExpirationReminderEmail(input: {
  customerName: string;
  requestNumber: string;
  expiresAt: string;
  offerLink: string;
  /** Set when the customer has already accepted and still owes payment. */
  invoiceUrl?: string;
}): { subject: string; bodyText: string } {
  // This is the last thing the customer hears before the hold lapses, so it has
  // to ask for the one thing that is actually outstanding.
  if (input.invoiceUrl) {
    return {
      subject: `Reminder: complete payment before your UPT plant hold ends (${input.requestNumber})`,
      bodyText: [
        `Hi ${input.customerName || "there"},`,
        "",
        `The plants you accepted on ${input.requestNumber} are held for you until ${input.expiresAt}. Complete your payment before then to keep them.`,
        "",
        "Complete your payment:",
        input.invoiceUrl,
        "",
        "Your offer:",
        input.offerLink,
        "",
        "Thank you,",
        "Unsolicited Plant Talks",
      ].join("\n"),
    };
  }

  return {
    subject: `Reminder: your UPT plant offer expires soon (${input.requestNumber})`,
    bodyText: [
      `Hi ${input.customerName || "there"},`,
      "",
      `Your offer for ${input.requestNumber} expires at ${input.expiresAt}.`,
      "",
      "Review your offer:",
      input.offerLink,
      "",
      "Thank you,",
      "Unsolicited Plant Talks",
    ].join("\n"),
  };
}

export function buildCheckoutEmail(input: {
  customerName: string;
  requestNumber: string;
  invoiceUrl: string;
}): { subject: string; bodyText: string } {
  return {
    subject: `Payment link for ${input.requestNumber}`,
    bodyText: [
      `Hi ${input.customerName || "there"},`,
      "",
      `Here is your checkout / payment link for ${input.requestNumber}:`,
      input.invoiceUrl,
      "",
      "Thank you,",
      "Unsolicited Plant Talks",
    ].join("\n"),
  };
}

export type OfferPlantItem = {
  id: string;
  sourceItemId: string;
  plantName: string;
  price: number;
  photoUrl: string;
  photoUrls: string[];
  notesFromUpt: string;
  quantity: number;
  availability: ItemAvailabilityStatus;
  unavailableReason?: UnavailableReason;
  /** Frozen when the offer was sent, like every other field here. */
  fulfillmentType: FulfillmentType;
  /** The store listing photo, shown in place of an exact plant's own photos. */
  listingImageUrl?: string;
  listingProductTitle?: string;
  listingVariantTitle?: string;
  /** The variant a Grower's Choice line is billed against and reserved from. */
  listingVariantGid?: string;
};

export type SampleCustomerOffer = {
  title: string;
  expirationDays: number;
  expiresAt: string;
  expiresAtIso: string;
  urgencyMessage: string;
  holdMessage: string;
  fedexUpgradeLabel: string;
  fedexUpgradePrice: number;
  customerEmail: string;
  customerName: string;
  requestNumber: string;
  items: OfferPlantItem[];
};
