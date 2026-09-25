export type Stats = {
  newRequests: number;
  pending: number;
  closed: number;
  expired: number;
};

export type RequestRow = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  plantsRequested: string;
  status: string;
  submittedAtIso: string;
  closedAtIso?: string;
  expiredAtIso?: string;
  hasResponded: boolean;
  hasExistingOrder: boolean;
  isPurchased?: boolean;
};

export type OfferProblem = {
  itemName: string;
  missing: string[];
};

export type RequestItem = {
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
};

export type RequestDetail = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  status: string;
  submittedAtIso: string;
  closedAtIso?: string;
  expiredAtIso?: string;
  paidAtIso?: string;
  hasExistingOrder: boolean;
  isPurchased?: boolean;
  hasResponded: boolean;
  canEditItems: boolean;
  canSendOffer: boolean;
  canCloseDeclined: boolean;
  canOverrideClose: boolean;
  offerProblems: OfferProblem[];
  sentOffer?: {
    expirationDays: number;
    sentAtIso: string;
    expiresAt: string;
    expiresAtIso: string;
    shippingFeeOverride?: number;
  };
  internalNotes: Array<{ id: string; body: string; createdAtIso: string }>;
  customerResponse?: {
    items: Array<{
      sourceItemId: string;
      choice: "accept" | "reject" | "unavailable";
    }>;
  } | null;
  items: RequestItem[];
};

export type StockCandidate = {
  productTitle: string;
  variantTitle: string;
  variantGid: string;
  sku?: string;
  price: number;
  inventoryQuantity?: number;
  inventoryTracked?: boolean;
  unlinkableReason: string | null;
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  pendingAdminOverrideClose?: boolean;
  sent?: boolean;
  request?: RequestDetail;
  stockSearch?: {
    itemId: string;
    term: string;
    results: StockCandidate[];
  };
};

export const UNAVAILABLE_REASONS = [
  "currently not in UPT prop circulation",
  "available in 2+ mos",
  "available in 2-3weeks",
  "not in our current inventory",
  "other",
] as const;

export type FulfillmentRoute = "exact_plant" | "growers_choice" | "not_available";

export type ExactPlantFilter =
  | "all"
  | "not_yet_listed"
  | "flagged"
  | "listed"
  | "dismissed";

export type ExactPlantRow = {
  requestItemId: string;
  requestId: string;
  requestNumber: string;
  title: string;
  price: number;
  weightLbs: number;
  photoUrl?: string;
  releaseReason: string;
  releaseLabel: string;
  listingStatus: ExactPlantFilter;
  listingLabel: string;
  eligibleAt: string;
  canDismiss: boolean;
  canList: boolean;
  productAdminUrl?: string;
  lastError?: string;
};

export type ExactPlantReview = {
  requestItemId: string;
  requestId: string;
  releaseReason: string;
  releaseLabel: string;
  draft: {
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
  };
  listing: {
    status: string;
    shopifyProductGid?: string;
    productAdminUrl?: string;
    lastError?: string;
  } | null;
  canDismiss: boolean;
  canList: boolean;
  listed: boolean;
};

export type ExactPlantActionResult = {
  ok: boolean;
  error?: string;
  pendingDismiss?: boolean;
  listed?: boolean;
  review?: ExactPlantReview;
};

export type PropagationPlanningOccurrence = {
  offerItemId: string;
  requestId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  plantName: string;
  unavailableReason: string | null;
  customerFacingNotes: string;
  customerRequestNotes: string | null;
};

export type PropagationCategoryOtherOccurrence = {
  offerItemId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  customerFacingNotes: string;
};

export type PropagationHistoryOccurrence = {
  offerItemId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  unavailableReason: string;
  customerFacingNotes: string;
};

export type PropagationCategoryPlantRow = {
  groupKey: string;
  displayName: string;
  uniqueCustomerCount: number;
  oldestRequestAtIso: string;
  newSinceDone: number;
  newSinceClosed: number;
  state: {
    done: boolean;
    closed: boolean;
    completedAtIso: string | null;
    closedAtIso: string | null;
    propNotes: string;
    updatedAtIso: string | null;
  };
  historyOccurrences: PropagationHistoryOccurrence[];
  otherOccurrences: PropagationCategoryOtherOccurrence[];
};

export type PropagationTabId = "prop" | "inventory" | "check_props" | "other";

export type PropagationPlanningTab = {
  id: PropagationTabId;
  title: string;
  actionLabel: string | null;
  plants: PropagationCategoryPlantRow[];
};

export type PropagationPlanningCategory = {
  id: string;
  title: string;
  actionLabel: string;
  plants: PropagationCategoryPlantRow[];
};

export type PropagationPlanningPayload = {
  summary: {
    active: number;
    done: number;
    closed: number;
    unavailableInRange: number;
  };
  tabs: PropagationPlanningTab[];
  /** Legacy API field; normalized into tabs when tabs[] is absent. */
  categories?: PropagationPlanningCategory[];
  filters: {
    status: "active" | "done" | "closed" | "all";
    dateRange: "all" | "90d" | "30d";
    sort: "most_requested" | "oldest_request" | "az";
    q: string;
  };
};

export type PropagationPlanningActionResult = {
  ok: boolean;
  error?: string;
};

export type ShopSettings = {
  fedexRemovalWarning: string;
  adminNotificationEmail: string;
  adminEmailNewRequest: boolean;
  adminEmailCustomerResponse: boolean;
  adminEmailPaymentAfterVoid: boolean;
  adminPushNewRequest: boolean;
  adminPushItemStatusUpdate: boolean;
  registeredPushDevices: number;
  fedexProductHandle: string;
  fedexProductSku: string;
  heatPackAddonEnabled: boolean;
  heatPackProductHandle: string;
  heatPackProductSku: string;
  heatPackDescription: string;
};
