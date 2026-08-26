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
  hasResponded: boolean;
  hasExistingOrder: boolean;
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
  hasExistingOrder: boolean;
  canEditItems: boolean;
  canSendOffer: boolean;
  canCloseDeclined: boolean;
  canOverrideClose: boolean;
  offerProblems: OfferProblem[];
  sentOffer?: {
    expirationDays: number;
    sentAtIso: string;
    expiresAtIso: string;
    shippingFeeOverride?: number;
  };
  internalNotes: Array<{ id: string; body: string; createdAtIso: string }>;
  items: RequestItem[];
};

export type StockCandidate = {
  productTitle: string;
  variantTitle: string;
  variantGid: string;
  sku?: string;
  price: number;
  inventoryQuantity?: number;
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

export type ShopSettings = {
  fedexRemovalWarning: string;
  adminNotificationEmail: string;
  adminEmailNewRequest: boolean;
  adminEmailCustomerResponse: boolean;
  adminEmailPaymentAfterVoid: boolean;
  fedexProductHandle: string;
  fedexProductSku: string;
};
