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
  expiresAt: string;
  expiresAtIso: string;
  expirationDays: OfferExpirationDays;
};

export type PlantItem = {
  id: string;
  plantName: string;
  offeredName: string;
  quantity: number;
  itemStatus: PlantItemStatus;
  availability: ItemAvailabilityStatus;
  unavailableReason: UnavailableReason;
  price: number;
  weightLbs: number;
  budget?: string;
  customerRequestNotes?: string;
  adminNotes: string;
  customerFacingNotes: string;
  photoPreviewUrl: string;
  photoUrls: string[];
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
  expiredAt?: string;
  paidAt?: string;
  items: PlantItem[];
  sentOffer?: SentOffer;
  /** Undefined until an offer has been sent. See `offerHasPayableItems`. */
  hasPayableItems?: boolean;
};

export type CustomerMyRequestRow = {
  id: string;
  requestNumber: string;
  submittedDate: string;
  plantsRequested: string;
  status: RequestStatus;
  /** Undefined until an offer has been sent. */
  hasPayableItems?: boolean;
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

export const FEDEX_PRODUCT_URL =
  "https://unsolicitedplanttalks.com/products/upgrade-to-fedex-priority-overnight-for-just-15-extra";

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

/**
 * Pending is stored from the moment the offer is sent and nothing revises it
 * when the answer leaves nothing to buy, so the label — not the status — is
 * what has to tell a customer who rejected every plant, or who was offered
 * nothing available, that no money is owed.
 */
export function formatCustomerStatusLabel(
  status: RequestStatus,
  options: { hasPayableItems?: boolean } = {},
): string {
  if (status === "Pending") {
    return options.hasPayableItems === false
      ? NOTHING_TO_PAY_LABEL
      : NEEDS_PAYMENT_LABEL;
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

export function getOfferHoldMessage(expiresAt: string): string {
  return `These exact plants are being held for you until ${expiresAt}. After that, this offer may be released.`;
}

export function getOfferUrgencyMessage(): string {
  return "These exact plants are reserved for you. Review and respond before this offer expires.";
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

export type BehaviorFlag =
  | "Good Customer"
  | "Strong Buyer"
  | "Partial Buyer"
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
};

export function buildDraftOrderLineItems(input: {
  acceptedItems: Array<{
    plantName: string;
    quantity: number;
    price: number;
    weightLbs: number;
  }>;
  fedexSelected: boolean;
  fedexLabel: string;
  fedexPrice: number;
}): DraftOrderLineItem[] {
  const lines: DraftOrderLineItem[] = input.acceptedItems.map((item) => ({
    title: item.plantName,
    quantity: normalizeQuantity(item.quantity),
    price: normalizePrice(item.price),
    weightLbs: normalizeWeight(item.weightLbs),
    kind: "plant",
  }));

  if (input.fedexSelected && lines.length > 0) {
    lines.push({
      title: input.fedexLabel,
      quantity: 1,
      price: normalizePrice(input.fedexPrice),
      weightLbs: 0,
      kind: "fedex",
    });
  }

  return lines;
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
  fedexVariantGid?: string;
}) {
  return {
    email: input.customerEmail,
    note: `UPT plant request ${input.requestNumber}`,
    tags: [
      DRAFT_ORDER_TAG,
      input.requestNumber,
      draftOrderIdempotencyTag(input.requestId),
    ],
    lineItems: input.lineItems.map((line) => {
      // The real variant carries the weight, but not the price: the customer
      // was quoted, emailed and shown an amount when they answered the offer,
      // and Shopify must bill that rather than whatever the variant costs by
      // the time they open the invoice.
      if (line.kind === "fedex" && input.fedexVariantGid) {
        return {
          variantId: input.fedexVariantGid,
          quantity: 1,
          originalUnitPriceWithCurrency: {
            amount: line.price.toFixed(2),
            currencyCode: input.currencyCode,
          },
        };
      }
      return {
        title: line.title,
        originalUnitPriceWithCurrency: {
          amount: line.price.toFixed(2),
          currencyCode: input.currencyCode,
        },
        quantity: line.quantity,
        weight: { value: line.weightLbs, unit: "POUNDS" as const },
        // Shopify defaults a custom line item to requiresShipping: false, and a
        // draft order with nothing shippable collects no delivery address and
        // quotes no shipping. UPT ships live plants: without this the merchant
        // gets a paid order with a weight, a customer, and nowhere to send it.
        // The FedEx line above is the shipping upgrade itself, so it stays
        // unshippable and is priced from its own variant.
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

export type ConfirmationEmailInput = {
  customerName: string;
  customerEmail: string;
  requestNumber: string;
  acceptedItems: Array<{
    plantName: string;
    price: number;
    quantity: number;
    customerNotes: string;
  }>;
  fedexSelected: boolean;
  fedexPrice: number;
  fedexDisclaimer?: string;
  invoiceUrl?: string;
};

export function buildConfirmationEmail(input: ConfirmationEmailInput): {
  subject: string;
  bodyText: string;
} {
  const lines = [
    `Hi ${input.customerName || "there"},`,
    "",
    `Your UPT plant offer selections for ${input.requestNumber} are confirmed.`,
    "",
    "Accepted items:",
  ];

  if (input.acceptedItems.length === 0) {
    lines.push("- None");
  } else {
    for (const item of input.acceptedItems) {
      const notes = item.customerNotes.trim()
        ? ` Notes: ${item.customerNotes.trim()}`
        : "";
      lines.push(
        `- ${item.plantName} — ${formatCurrency(item.price)}${notes}`,
      );
    }
  }

  lines.push("");
  if (input.fedexSelected) {
    lines.push(
      `FedEx Priority Overnight Upgrade: selected (${formatCurrency(input.fedexPrice)})`,
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
    lines.push("Checkout / payment link:");
    lines.push(input.invoiceUrl);
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push("Unsolicited Plant Talks");

  return {
    subject: `Your UPT plant offer confirmation (${input.requestNumber})`,
    bodyText: lines.join("\n"),
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

export function buildOfferReadyEmail(input: {
  customerName: string;
  requestNumber: string;
  expiresAt: string;
  offerLink: string;
}): { subject: string; bodyText: string } {
  return {
    subject: `Your UPT plant offer is ready (${input.requestNumber})`,
    bodyText: [
      `Hi ${input.customerName || "there"},`,
      "",
      `Your personal plant offer for ${input.requestNumber} is ready.`,
      getOfferHoldMessage(input.expiresAt),
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
