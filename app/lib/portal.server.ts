import type {
  CustomerResponse as DbCustomerResponse,
  Offer,
  OfferItem,
  PhotoReference,
  PlantRequest as DbPlantRequest,
  RequestItem,
} from "@prisma/client";

import prisma from "../db.server";
import { customerLinksForShop } from "./customer-links.server";
import {
  formatCustomerDateTime,
  normalizeIanaTimeZone,
} from "./customer-time";
import { isDemoDataEnabled } from "./environment.server";
import {
  normalizeStoredFulfillmentType,
  resolveFulfillmentType,
  resolveLinkedWeightLbs,
  type StockVariantCandidate,
  type StoredFulfillmentType,
} from "./growers-choice";
import { assignCanonicalPlantsForRequest } from "./plant-identity.server";
import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  DEFAULT_UNAVAILABLE_REASON,
  FEDEX_PRODUCT_HANDLE,
  formatDate,
  formatDateTime,
  formatRequestNumber,
  GLOBAL_REQUEST_SEQUENCE_YEAR,
  parseRequestNumber,
  getOfferHoldMessage,
  getOfferUrgencyMessage,
  incompleteOfferItems,
  normalizePrice,
  normalizeQuantity,
  normalizeRequestStatus,
  normalizeUnavailableReason,
  normalizeWeight,
  offerHasPayableItems,
  offerIsAllExactPlants,
  offerReadinessMessage,
  PAYMENT_AFTER_VOID_REASON,
  type CustomerOfferResponse,
  type CustomerResponseItem,
  type CustomerResponseItemChoice,
  type DraftOrderLineItem,
  type IncompleteOfferItem,
  type AcceptedDraftOrderItem,
  type ItemAvailabilityStatus,
  type LinkedStockSnapshot,
  type OfferExpirationDays,
  type OfferPlantItem,
  type PlantItem,
  type PlantItemStatus,
  type PlantRequest,
  type SampleCustomerOffer,
  type SentOffer,
  type UnavailableReason,
} from "./portal";

export const prismaClient = prisma;

export class OfferAlreadyAnsweredError extends Error {
  constructor() {
    super("This offer has already been answered.");
    this.name = "OfferAlreadyAnsweredError";
  }
}

/**
 * The hold ran out before the customer's answer was saved.
 *
 * Reading the request runs the expiry sweep first, so a customer submitting as
 * their hold lapses expires their own offer and then meets this. That is the
 * expected shape of it, not a narrow window: the reminder email exists to make
 * people answer at the last minute. It has to reach the customer as a message
 * rather than an unhandled error, or their choices are lost behind a crash page.
 */
/** The request was already finished — paid, or closed by the customer. */
export class RequestClosedError extends Error {
  constructor() {
    super("This request is closed.");
    this.name = "RequestClosedError";
  }
}

export class OfferExpiredError extends Error {
  constructor() {
    super("This offer has expired.");
    this.name = "OfferExpiredError";
  }
}

/**
 * An Available plant was about to be offered without a photo, a price or a
 * weight. The admin page disables Send Offer in that state, but this is the
 * authority: the offer snapshot is frozen on send, so an item sent incomplete
 * can never be corrected afterwards.
 */
export class OfferIncompleteError extends Error {
  readonly problems: IncompleteOfferItem[];

  constructor(problems: IncompleteOfferItem[]) {
    super(offerReadinessMessage(problems));
    this.name = "OfferIncompleteError";
    this.problems = problems;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

type RequestWithRelations = DbPlantRequest & {
  items: Array<RequestItem & { photos: PhotoReference[] }>;
  offer?:
    | (Offer & {
        items: OfferItem[];
      })
    | null;
  response?: (DbCustomerResponse & { items: Array<{ choice: string }> }) | null;
  draftOrder?: {
    invoiceUrl: string | null;
    shopifyDraftOrderGid: string | null;
    createdAt: Date;
    voidedAt?: Date | null;
    voidError?: string | null;
  } | null;
};

/**
 * Plants are shown in the order the customer typed them.
 *
 * Neither table carries a position column, and without an explicit order
 * PostgreSQL returns rows however it likes — so the same request could list its
 * plants in a different order on each page load, on the admin's screen and on
 * the customer's offer. Items are created in one call in submission order, so
 * creation order is that order; the id breaks ties within the same millisecond.
 */
export const REQUEST_ITEM_ORDER = [
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

/** Offer items have no timestamp; they are written in request-item order. */
export const OFFER_ITEM_ORDER = { id: "asc" as const };

const requestInclude = {
  items: {
    include: { photos: { orderBy: { sortOrder: "asc" as const } } },
    orderBy: REQUEST_ITEM_ORDER,
  },
  offer: { include: { items: { orderBy: OFFER_ITEM_ORDER } } },
  // Only the choices: enough to tell a request that can still take money from
  // one whose answer left nothing to buy, without loading every snapshot.
  response: { include: { items: { select: { choice: true } } } },
  draftOrder: true,
} as const;

/**
 * Stock imagery is only ever acceptable on a demo shop. A real offer shows the
 * exact plant the customer is buying, so an item with no uploaded photo must
 * render as having no photo rather than borrowing an unrelated one.
 */
function placeholderPhoto(seed: string): string {
  if (!isDemoDataEnabled()) return "";
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/800`;
}

function withPlaceholderFallback(urls: string[], seed: string): string[] {
  if (urls.length > 0) return urls;
  const placeholder = placeholderPhoto(seed);
  return placeholder ? [placeholder] : [];
}

function parsePhotoUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

/**
 * The linked store listing as the row holds it, or undefined when nothing is
 * linked. The variant id is what makes a link real: without it there is nothing
 * to bill, reserve or show.
 */
function toLinkedStock(item: {
  linkedProductGid: string | null;
  linkedProductTitle: string | null;
  linkedProductHandle: string | null;
  linkedVariantGid: string | null;
  linkedVariantTitle: string | null;
  linkedVariantSku: string | null;
  linkedVariantPrice: number | null;
  linkedVariantWeightLbs: number | null;
  linkedInventoryQuantity: number | null;
  linkedInventoryTracked: boolean | null;
  linkedImageUrl: string | null;
  linkedAt: Date | null;
}): LinkedStockSnapshot | undefined {
  if (!item.linkedVariantGid || !item.linkedProductGid) return undefined;
  return {
    productGid: item.linkedProductGid,
    productTitle: item.linkedProductTitle ?? "",
    productHandle: item.linkedProductHandle ?? undefined,
    variantGid: item.linkedVariantGid,
    variantTitle: item.linkedVariantTitle ?? "",
    sku: item.linkedVariantSku ?? undefined,
    variantPrice: item.linkedVariantPrice ?? undefined,
    variantWeightLbs: item.linkedVariantWeightLbs ?? undefined,
    inventoryQuantity: item.linkedInventoryQuantity ?? undefined,
    inventoryTracked: Boolean(item.linkedInventoryTracked),
    imageUrl: item.linkedImageUrl ?? undefined,
    linkedAt: item.linkedAt ? formatDateTime(item.linkedAt) : undefined,
  };
}

function toPlantItem(item: RequestItem & { photos: PhotoReference[] }): PlantItem {
  const photoUrls = withPlaceholderFallback(
    item.photos.map((photo) => photo.url),
    item.id,
  );

  const adminNotes = item.customerRequestNotes ?? "";

  return {
    id: item.id,
    plantName: item.plantName,
    offeredName: item.offeredName || item.plantName,
    quantity: normalizeQuantity(item.quantity),
    itemStatus: (item.itemStatus as PlantItemStatus) || "Requested",
    availability:
      item.availability === "not_available" ? "not_available" : "available",
    unavailableReason: normalizeUnavailableReason(item.unavailableReason),
    fulfillmentType: resolveFulfillmentType(item),
    linkedStock: toLinkedStock(item),
    fulfillmentIssue: item.fulfillmentIssue ?? undefined,
    price: normalizePrice(item.price),
    weightLbs: normalizeWeight(item.weightLbs),
    budget: item.budget ?? undefined,
    customerRequestNotes: item.customerRequestNotes ?? undefined,
    adminNotes,
    customerFacingNotes: item.customerFacingNotes ?? "",
    photoPreviewUrl: photoUrls[0] ?? "",
    photoUrls,
    // Only the real rows, never the demo placeholder, which has nothing to edit.
    photos: item.photos.map((photo) => ({ id: photo.id, url: photo.url })),
  };
}

function toSentOffer(offer: Offer, requestId: string): SentOffer {
  return {
    offerLink: offer.offerLink || `/app/customer-offer-preview?requestId=${requestId}`,
    sentAt: formatDateTime(offer.sentAt),
    expiresAt: formatDateTime(offer.expiresAt),
    expiresAtIso: offer.expiresAt.toISOString(),
    expirationDays: offer.expirationDays as OfferExpirationDays,
  };
}

export function toPlantRequest(request: RequestWithRelations): PlantRequest {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    customer: request.customerName,
    email: request.customerEmail,
    shopifyCustomerId: request.shopifyCustomerId ?? undefined,
    status: normalizeRequestStatus(request.status),
    submittedDate: formatDate(request.submittedAt),
    submittedAtIso: request.submittedAt.toISOString(),
    closedAt: request.closedAt ? formatDateTime(request.closedAt) : undefined,
    closedAtIso: request.closedAt?.toISOString(),
    expiredAt: request.expiredAt ? formatDateTime(request.expiredAt) : undefined,
    expiredAtIso: request.expiredAt?.toISOString(),
    paidAt: request.paidAt ? formatDateTime(request.paidAt) : undefined,
    paidAtIso: request.paidAt?.toISOString(),
    items: request.items.map(toPlantItem),
    sentOffer: request.offer ? toSentOffer(request.offer, request.id) : undefined,
    hasPayableItems: request.offer
      ? offerHasPayableItems({
          offerItems: request.offer.items,
          responseChoices: request.response
            ? request.response.items.map((item) => item.choice)
            : null,
        })
      : undefined,
    hasResponded: Boolean(request.response),
  };
}

/**
 * Flips Pending requests whose hold has run out to Expired.
 *
 * Called from every request loader, every list, the analytics page and the
 * hourly cron, so several sweeps overlap constantly — a single admin page load
 * fires more than one. Each request is therefore claimed with a conditional
 * update and only the sweep that actually changed the row writes the history
 * entry; otherwise two sweeps both saw the same overdue offer and both appended
 * "Offer expired before payment".
 *
 * The claims run as one batch rather than a transaction per request. This is on
 * the critical path of a user's page load, and it is slowest exactly when the
 * backlog is largest, which is the first page load after a quiet period.
 */
export async function expireOverdueOffers(shop: string, now = new Date()): Promise<number> {
  const pending = await prisma.plantRequest.findMany({
    where: {
      shop,
      status: "Pending",
      paidAt: null,
      offer: { expiresAt: { lte: now } },
    },
    select: { id: true },
  });
  if (pending.length === 0) return 0;

  const claimed: string[] = [];
  for (const request of pending) {
    const { count } = await prisma.plantRequest.updateMany({
      where: { id: request.id, shop, status: "Pending", paidAt: null },
      data: { status: "Expired", expiredAt: now },
    });
    if (count === 1) claimed.push(request.id);
  }

  if (claimed.length > 0) {
    await prisma.statusEvent.createMany({
      data: claimed.map((requestId) => ({
        requestId,
        fromStatus: "Pending",
        toStatus: "Expired",
        reason: "Offer expired before payment",
      })),
    });
  }

  return claimed.length;
}

async function loadRequest(
  shop: string,
  requestId: string,
): Promise<RequestWithRelations | null> {
  await expireOverdueOffers(shop);
  return prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: requestInclude,
  });
}

/**
 * Upserts rather than reads-then-creates. Every admin and customer loader calls
 * this, and a browser opens several of them at once, so on the first page load
 * after install two concurrent inserts would race `ShopSettings.shop`'s unique
 * index and one of them would 500.
 */
export async function getShopSettings(shop: string) {
  return prisma.shopSettings.upsert({
    where: { shop },
    create: {
      shop,
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
      fedexProductHandle: FEDEX_PRODUCT_HANDLE,
    },
    // Assigning `shop` its own value is a no-op, but the update payload has to
    // be non-empty: given an empty one Prisma abandons the atomic
    // `ON CONFLICT DO UPDATE` and emulates the upsert with a read followed by a
    // write, which is the race this function is trying to avoid.
    update: { shop },
  });
}

export async function updateShopSettings(
  shop: string,
  data: {
    fedexRemovalWarning?: string;
    adminNotificationEmail?: string;
    fedexVariantGid?: string | null;
    fedexUpgradePrice?: number;
  },
) {
  await getShopSettings(shop);
  return prisma.shopSettings.update({
    where: { shop },
    data: {
      ...(data.fedexRemovalWarning !== undefined
        ? {
            fedexRemovalWarning:
              data.fedexRemovalWarning.trim() || DEFAULT_FEDEX_REMOVAL_WARNING,
          }
        : {}),
      ...(data.adminNotificationEmail !== undefined
        ? { adminNotificationEmail: data.adminNotificationEmail.trim() }
        : {}),
      ...(data.fedexVariantGid !== undefined
        ? { fedexVariantGid: data.fedexVariantGid }
        : {}),
      ...(data.fedexUpgradePrice !== undefined
        ? { fedexUpgradePrice: normalizePrice(data.fedexUpgradePrice) }
        : {}),
    },
  });
}

async function nextRequestNumber(shop: string): Promise<string> {
  const sequence = await prisma.requestNumberSequence.upsert({
    where: { shop_year: { shop, year: GLOBAL_REQUEST_SEQUENCE_YEAR } },
    create: { shop, year: GLOBAL_REQUEST_SEQUENCE_YEAR, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });

  return formatRequestNumber(sequence.nextValue - 1);
}

export async function findOrCreateCustomer(
  shop: string,
  input: {
    name: string;
    email: string;
    shopifyCustomerId?: string;
  },
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  // `CustomerProfile` is keyed on (shop, email). A blank email would collapse
  // every unidentified shopper into a single shared profile.
  if (!email) {
    throw new Error(
      "A customer email is required. Could not read the signed-in customer's email from Shopify.",
    );
  }

  if (input.shopifyCustomerId) {
    const byShopify = await prisma.customerProfile.findFirst({
      where: { shop, shopifyCustomerId: input.shopifyCustomerId },
    });
    if (byShopify) {
      return prisma.customerProfile.update({
        where: { id: byShopify.id },
        data: {
          name: name || byShopify.name,
          email: email || byShopify.email,
        },
      });
    }
  }

  // Upsert rather than read-then-create: a first-time customer who double
  // submits raced two inserts against the unique index on (shop, email), and
  // the loser's request was lost to a 500. Omitting a field leaves the stored
  // value alone, which is what the read-then-update path used to do.
  return prisma.customerProfile.upsert({
    where: { shop_email: { shop, email } },
    create: {
      shop,
      name: name || email,
      email,
      shopifyCustomerId: input.shopifyCustomerId,
    },
    update: {
      // A no-op that keeps the payload non-empty even when there is nothing to
      // change, so Prisma emits an atomic `ON CONFLICT DO UPDATE` rather than
      // emulating the upsert with a racy read-then-write.
      email,
      ...(name ? { name } : {}),
      ...(input.shopifyCustomerId !== undefined
        ? { shopifyCustomerId: input.shopifyCustomerId }
        : {}),
    },
  });
}

export async function getCustomerTimeZone(
  shop: string,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = await prisma.customerProfile.findUnique({
    where: { shop_email: { shop, email: normalized } },
    select: { timeZone: true },
  });
  return normalizeIanaTimeZone(row?.timeZone);
}

/**
 * Writes a captured IANA zone onto that shop+email profile only.
 * A forged or empty value is ignored; another customer is never updated.
 */
export async function saveCustomerTimeZone(
  shop: string,
  email: string,
  raw: unknown,
): Promise<string | null> {
  const timeZone = normalizeIanaTimeZone(raw);
  const normalized = email.trim().toLowerCase();
  if (!timeZone || !normalized) return null;
  const updated = await prisma.customerProfile.updateMany({
    where: { shop, email: normalized },
    data: { timeZone },
  });
  return updated.count > 0 ? timeZone : null;
}

export async function listRequests(shop: string): Promise<PlantRequest[]> {
  await expireOverdueOffers(shop);
  const rows = await prisma.plantRequest.findMany({
    where: { shop },
    include: requestInclude,
    orderBy: { submittedAt: "desc" },
  });
  return rows.map(toPlantRequest);
}

export async function getRequest(
  shop: string,
  requestId: string,
): Promise<PlantRequest | null> {
  const row = await loadRequest(shop, requestId);
  return row ? toPlantRequest(row) : null;
}

export async function markRequestViewed(shop: string, requestId: string) {
  await prisma.plantRequest.updateMany({
    where: { id: requestId, shop, firstViewedAt: null },
    data: { firstViewedAt: new Date() },
  });
}

/**
 * Mirrors `identityOwnsRequest`: a customer with a Shopify account id sees
 * requests carrying that id, plus their own pre-account requests matched by
 * email. Requests already claimed by a *different* account id are never
 * returned, even when the email happens to match.
 */
export async function listCustomerRequests(
  shop: string,
  identity: { email?: string; shopifyCustomerId?: string },
): Promise<PlantRequest[]> {
  await expireOverdueOffers(shop);
  const email = identity.email?.trim().toLowerCase();
  const identityFilters: Array<Record<string, unknown>> = [];

  if (identity.shopifyCustomerId) {
    identityFilters.push({ shopifyCustomerId: identity.shopifyCustomerId });
    if (email) {
      identityFilters.push({ customerEmail: email, shopifyCustomerId: null });
    }
  } else if (email) {
    identityFilters.push({ customerEmail: email, shopifyCustomerId: null });
  }

  if (identityFilters.length === 0) return [];

  const rows = await prisma.plantRequest.findMany({
    where: {
      shop,
      OR: identityFilters,
    },
    include: requestInclude,
    orderBy: { submittedAt: "desc" },
  });
  return rows.map(toPlantRequest);
}

export async function submitCustomerRequest(
  shop: string,
  input: {
    name: string;
    email: string;
    shopifyCustomerId?: string;
    items: Array<{ plantName: string; notes?: string }>;
  },
): Promise<PlantRequest> {
  const customer = await findOrCreateCustomer(shop, input);
  const requestNumber = await nextRequestNumber(shop);

  const created = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      status: "New",
      items: {
        create: input.items.map((item) => ({
          plantName: item.plantName.trim(),
          offeredName: item.plantName.trim(),
          customerRequestNotes: item.notes?.trim() || null,
          quantity: 1,
          availability: "available",
          unavailableReason: DEFAULT_UNAVAILABLE_REASON,
          price: 0,
          weightLbs: 0,
          itemStatus: "Requested",
        })),
      },
      statusEvents: {
        create: {
          toStatus: "New",
          reason: "Customer submitted request",
        },
      },
    },
    include: requestInclude,
  });

  // Best effort on purpose. The customer's request is already saved and their
  // own wording is on it; a failure to work out which plant they meant is an
  // analytics gap the backfill sweep closes on the next admin page load, and it
  // must never turn a submitted request into an error page.
  try {
    await assignCanonicalPlantsForRequest(shop, created.id);
  } catch (error) {
    console.warn(
      `Could not resolve a canonical plant identity for request ${created.requestNumber}.`,
      error,
    );
  }

  return toPlantRequest(created);
}

/**
 * Everything that makes an item a Grower's Choice line, cleared in one go.
 *
 * Used when the admin switches the item back to an exact plant or to Not
 * Available. A link left behind would be invisible on the page and still be the
 * variant the draft order billed and reserved.
 */
const CLEARED_LINKED_STOCK = {
  linkedProductGid: null,
  linkedProductTitle: null,
  linkedProductHandle: null,
  linkedVariantGid: null,
  linkedVariantTitle: null,
  linkedVariantSku: null,
  linkedVariantPrice: null,
  linkedVariantWeightLbs: null,
  linkedInventoryQuantity: null,
  linkedInventoryTracked: null,
  linkedImageUrl: null,
  linkedAt: null,
} as const;

export async function updateRequestItem(
  shop: string,
  input: {
    requestId: string;
    itemId: string;
    offeredName?: string;
    availability?: ItemAvailabilityStatus;
    fulfillmentType?: StoredFulfillmentType;
    unavailableReason?: UnavailableReason;
    price?: number;
    weightLbs?: number;
    customerFacingNotes?: string;
    photoUrls?: string[];
  },
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, input.requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error("Only New requests can be edited before an offer is sent.");
  }

  const item = request.items.find((entry) => entry.id === input.itemId);
  if (!item) return null;

  // Which of the three routes the item ends up on, given whatever this call
  // changed. Both fields have to be read together: picking Not Available leaves
  // a stored `growers_choice` alone, and picking a route leaves availability
  // alone unless it is also being set.
  const nextFulfillment = resolveFulfillmentType({
    availability: input.availability ?? item.availability,
    fulfillmentType: input.fulfillmentType ?? item.fulfillmentType,
  });

  await prisma.requestItem.update({
    where: { id: item.id },
    data: {
      ...(input.offeredName !== undefined
        ? { offeredName: input.offeredName.trim() || item.plantName }
        : {}),
      ...(input.availability
        ? {
            availability: input.availability,
            itemStatus:
              input.availability === "not_available" ? "Unavailable" : "Requested",
          }
        : {}),
      ...(input.fulfillmentType
        ? { fulfillmentType: input.fulfillmentType }
        : {}),
      // Leaving the exact-plant route, or leaving Available at all, drops the
      // listing this item was going to be supplied from.
      ...(nextFulfillment === "growers_choice" ? {} : CLEARED_LINKED_STOCK),
      // A reason left over from a spell as Not Available would prefill itself
      // the next time the item is flipped back, so it goes when the plant does
      // become available.
      ...(input.availability === "available"
        ? { unavailableReason: null }
        : input.unavailableReason
          ? { unavailableReason: normalizeUnavailableReason(input.unavailableReason) }
          : {}),
      ...(input.price !== undefined ? { price: normalizePrice(input.price) } : {}),
      ...(input.weightLbs !== undefined
        ? { weightLbs: normalizeWeight(input.weightLbs) }
        : {}),
      ...(input.customerFacingNotes !== undefined
        ? { customerFacingNotes: input.customerFacingNotes }
        : {}),
    },
  });

  if (input.photoUrls) {
    await prisma.$transaction([
      prisma.photoReference.deleteMany({ where: { itemId: item.id } }),
      ...input.photoUrls.filter(Boolean).map((url, index) =>
        prisma.photoReference.create({
          data: { itemId: item.id, url, sortOrder: index },
        }),
      ),
    ]);
  }

  return getRequest(shop, input.requestId);
}

/**
 * Points a request item at a variant the store already sells.
 *
 * Linking reserves nothing and promises nothing: it records which listing the
 * plant would come from, and the price and weight to prefill from. The hold on
 * the stock is taken later, on the draft order, and only once the customer has
 * accepted — reserving here would take a plant off sale for every offer UPT
 * drafts, including the ones nobody answers.
 *
 * Refused after the offer is sent, along with every other customer-facing
 * field: the snapshot is what the customer answered and what they are billed
 * for.
 */
export async function linkExistingStock(
  shop: string,
  input: {
    requestId: string;
    itemId: string;
    variant: StockVariantCandidate;
  },
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, input.requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error(
      "Existing website stock can only be linked before an offer is sent.",
    );
  }

  const item = request.items.find((entry) => entry.id === input.itemId);
  if (!item) return null;

  const variant = input.variant;
  await prisma.requestItem.update({
    where: { id: item.id },
    data: {
      availability: "available",
      fulfillmentType: "growers_choice",
      itemStatus: item.itemStatus === "Unavailable" ? "Sourced" : item.itemStatus,
      unavailableReason: null,
      linkedProductGid: variant.productGid,
      linkedProductTitle: variant.productTitle,
      linkedProductHandle: variant.productHandle,
      linkedVariantGid: variant.variantGid,
      linkedVariantTitle: variant.variantTitle,
      linkedVariantSku: variant.sku,
      linkedVariantPrice: normalizePrice(variant.price),
      linkedVariantWeightLbs:
        variant.weightLbs === null ? null : normalizeWeight(variant.weightLbs),
      linkedInventoryQuantity: variant.inventoryQuantity,
      linkedInventoryTracked: variant.inventoryTracked,
      linkedImageUrl: variant.imageUrl,
      linkedAt: new Date(),
      // The listing's own price is the obvious starting point, but only when
      // nobody has priced this item yet: overwriting a price the admin typed
      // would silently undo their decision every time they changed the link.
      ...(normalizePrice(item.price) > 0
        ? {}
        : { price: normalizePrice(variant.price) }),
    },
  });

  return getRequest(shop, input.requestId);
}

/**
 * Drops the link and puts the item back on the exact-plant route, which is
 * where an item with nothing linked belongs.
 */
export async function unlinkExistingStock(
  shop: string,
  requestId: string,
  itemId: string,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error(
      "Existing website stock can only be unlinked before an offer is sent.",
    );
  }
  if (!request.items.some((entry) => entry.id === itemId)) return null;

  await prisma.requestItem.update({
    where: { id: itemId },
    data: { fulfillmentType: "exact_plant", ...CLEARED_LINKED_STOCK },
  });

  return getRequest(shop, requestId);
}

/**
 * Records why a plant could not be reserved, for the admin to read.
 *
 * The customer's answer is committed before the draft order is attempted, so
 * when the linked stock has gone in the meantime there is nobody left in the
 * request to tell — this and the status event are how the merchant finds out at
 * all. Written per item so a six-plant request names the one that failed.
 */
export async function recordFulfillmentIssues(
  shop: string,
  requestId: string,
  issues: Array<{ itemId: string; reason: string }>,
): Promise<void> {
  if (issues.length === 0) return;
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    select: { id: true, status: true, items: { select: { id: true } } },
  });
  if (!request) return;

  const known = new Set(request.items.map((item) => item.id));
  const recorded = issues.filter((issue) => known.has(issue.itemId));
  if (recorded.length === 0) return;

  for (const issue of recorded) {
    await prisma.requestItem.update({
      where: { id: issue.itemId },
      data: { fulfillmentIssue: issue.reason },
    });
  }

  await prisma.statusEvent.create({
    data: {
      requestId,
      fromStatus: request.status,
      toStatus: request.status,
      reason: `Existing stock unavailable: ${recorded
        .map((issue) => issue.reason)
        .join(" ")}`,
    },
  });
}

/** Clears the issues on a request whose draft order has since succeeded. */
export async function clearFulfillmentIssues(
  shop: string,
  requestId: string,
): Promise<void> {
  await prisma.requestItem.updateMany({
    where: { requestId, request: { shop }, fulfillmentIssue: { not: null } },
    data: { fulfillmentIssue: null },
  });
}

export async function addItemPhotos(
  shop: string,
  requestId: string,
  itemId: string,
  photos: Array<{ url: string; shopifyFileId?: string }>,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error("Photos can only be added before an offer is sent.");
  }

  const existing = request.items.find((item) => item.id === itemId)?.photos ?? [];
  const known = new Set(existing.map((photo) => photo.url));

  // The same URL twice is always a mistake — a double-submitted form or a
  // re-pasted link — and it freezes into the offer snapshot on send.
  const fresh = photos.filter((photo) => {
    if (known.has(photo.url)) return false;
    known.add(photo.url);
    return true;
  });
  if (fresh.length === 0) return getRequest(shop, requestId);

  await prisma.photoReference.createMany({
    data: fresh.map((photo, index) => ({
      itemId,
      url: photo.url,
      shopifyFileId: photo.shopifyFileId,
      sortOrder: existing.length + index,
    })),
  });

  return getRequest(shop, requestId);
}

/** Photos in display order, renumbered from zero so gaps cannot accumulate. */
async function resequencePhotos(itemId: string, orderedIds: string[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.photoReference.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
}

function assertPhotosEditable(request: RequestWithRelations): void {
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error("Photos can only be changed before an offer is sent.");
  }
}

export async function removeItemPhoto(
  shop: string,
  requestId: string,
  itemId: string,
  photoId: string,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  assertPhotosEditable(request);

  const photos = request.items.find((item) => item.id === itemId)?.photos ?? [];
  if (!photos.some((photo) => photo.id === photoId)) return getRequest(shop, requestId);

  await prisma.photoReference.delete({ where: { id: photoId } });
  await resequencePhotos(
    itemId,
    photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id),
  );

  return getRequest(shop, requestId);
}

/**
 * Moves one photo one place earlier or later.
 *
 * The first photo is the one the customer sees first, so ordering is a real
 * editorial decision rather than a nicety — and it is frozen into the offer
 * snapshot the moment the offer is sent.
 */
/**
 * Writes a whole photo order. Safe to replay: the same id list is a no-op.
 * Refuses a list that is not a permutation of the current photos.
 */
export async function reorderItemPhotos(
  shop: string,
  requestId: string,
  itemId: string,
  orderedIds: string[],
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  assertPhotosEditable(request);

  const photos = request.items.find((item) => item.id === itemId)?.photos ?? [];
  const current = photos.map((photo) => photo.id);
  if (orderedIds.length !== current.length) return getRequest(shop, requestId);
  if (new Set(orderedIds).size !== orderedIds.length) return getRequest(shop, requestId);
  if (!orderedIds.every((id) => current.includes(id))) return getRequest(shop, requestId);

  await resequencePhotos(itemId, orderedIds);
  return getRequest(shop, requestId);
}

export async function moveItemPhoto(
  shop: string,
  requestId: string,
  itemId: string,
  photoId: string,
  direction: "up" | "down",
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  assertPhotosEditable(request);

  const photos = request.items.find((item) => item.id === itemId)?.photos ?? [];
  const from = photos.findIndex((photo) => photo.id === photoId);
  if (from === -1) return getRequest(shop, requestId);

  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= photos.length) return getRequest(shop, requestId);

  const ordered = photos.map((photo) => photo.id);
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  await resequencePhotos(itemId, ordered);

  return getRequest(shop, requestId);
}

export async function sendOffer(
  shop: string,
  requestId: string,
  expirationDays: OfferExpirationDays,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") return null;

  const problems = incompleteOfferItems(
    request.items.map((item) => ({ ...item, linkedStock: toLinkedStock(item) })),
  );
  if (problems.length > 0) throw new OfferIncompleteError(problems);

  const sentAt = new Date();
  const expiresAt = new Date(sentAt);
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  await prisma.$transaction(async (tx) => {
    await tx.offer.create({
      data: {
        requestId,
        sentAt,
        expiresAt,
        expirationDays,
        offerLink: customerLinksForShop(shop).requestDetail(requestId),
        items: {
          create: request.items.map((item) => {
            const fulfillment = resolveFulfillmentType(item);
            const growersChoice = fulfillment === "growers_choice";
            return {
              requestItemId: item.id,
              plantName: item.offeredName || item.plantName,
              quantity: normalizeQuantity(item.quantity),
              price: normalizePrice(item.price),
              // The listing's own weight is what a Grower's Choice plant
              // actually ships on, so that is the figure the offer freezes and
              // the draft order bills shipping against.
              weightLbs: normalizeWeight(
                growersChoice ? resolveLinkedWeightLbs(item) : item.weightLbs,
              ),
              customerFacingNotes: item.customerFacingNotes,
              availability: item.availability,
              unavailableReason: item.unavailableReason,
              // Exact-plant photos are photographs of one individual plant. A
              // Grower's Choice customer is not being sold that individual, so
              // the offer carries the listing image instead and none of these.
              photoUrlsJson: JSON.stringify(
                growersChoice
                  ? []
                  : item.photos.map((photo) => photo.url).filter(Boolean),
              ),
              fulfillmentType: normalizeStoredFulfillmentType(item.fulfillmentType),
              ...(growersChoice
                ? {
                    linkedProductGid: item.linkedProductGid,
                    linkedProductTitle: item.linkedProductTitle,
                    linkedProductHandle: item.linkedProductHandle,
                    linkedVariantGid: item.linkedVariantGid,
                    linkedVariantTitle: item.linkedVariantTitle,
                    linkedVariantSku: item.linkedVariantSku,
                    linkedVariantWeightLbs: item.linkedVariantWeightLbs,
                    linkedImageUrl: item.linkedImageUrl,
                  }
                : {}),
            };
          }),
        },
      },
    });

    for (const item of request.items) {
      await tx.requestItem.update({
        where: { id: item.id },
        data: {
          itemStatus:
            item.availability === "available" ? "Offered" : "Unavailable",
        },
      });
    }

    await tx.plantRequest.update({
      where: { id: requestId },
      data: { status: "Pending" },
    });

    await tx.statusEvent.create({
      data: {
        requestId,
        fromStatus: "New",
        toStatus: "Pending",
        reason: `Offer sent (${expirationDays} days)`,
      },
    });
  });

  return getRequest(shop, requestId);
}

function offerItemToPlant(
  item: OfferItem,
  index: number,
  requestId: string,
): OfferPlantItem {
  const photoUrls = parsePhotoUrls(item.photoUrlsJson);
  const available = item.availability === "available";
  const fulfillmentType = resolveFulfillmentType(item);
  const growersChoice = fulfillmentType === "growers_choice";
  // A Grower's Choice line has exactly one image and it belongs to the listing,
  // so it never gets the demo placeholder an exact plant falls back to: an
  // unrelated stock photo standing in for a listing photo would be a picture of
  // nothing at all.
  const displayPhotos = !available
    ? []
    : growersChoice
      ? []
      : withPlaceholderFallback(photoUrls, item.requestItemId);
  return {
    id: `offer-${requestId}-${index + 1}`,
    sourceItemId: item.requestItemId,
    plantName: item.plantName,
    price: available ? normalizePrice(item.price) : 0,
    photoUrl: displayPhotos[0] ?? "",
    photoUrls: displayPhotos,
    notesFromUpt: item.customerFacingNotes,
    quantity: normalizeQuantity(item.quantity),
    availability: available ? "available" : "not_available",
    unavailableReason: available
      ? undefined
      : normalizeUnavailableReason(item.unavailableReason),
    fulfillmentType,
    ...(growersChoice && available
      ? {
          listingImageUrl: item.linkedImageUrl ?? undefined,
          listingProductTitle: item.linkedProductTitle ?? undefined,
          listingVariantTitle: item.linkedVariantTitle ?? undefined,
          listingVariantGid: item.linkedVariantGid ?? undefined,
        }
      : {}),
  };
}

export async function buildCustomerOffer(
  shop: string,
  requestId: string,
): Promise<SampleCustomerOffer | null> {
  const settings = await getShopSettings(shop);
  const request = await loadRequest(shop, requestId);
  if (!request?.offer) return null;

  const timeZone = await getCustomerTimeZone(shop, request.customerEmail);
  const expiresAt = formatCustomerDateTime(request.offer.expiresAt, timeZone);
  const allExactPlants = offerIsAllExactPlants(request.offer.items);
  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: request.offer.expirationDays,
    expiresAt,
    expiresAtIso: request.offer.expiresAt.toISOString(),
    urgencyMessage: getOfferUrgencyMessage(allExactPlants),
    holdMessage: getOfferHoldMessage(expiresAt, allExactPlants),
    fedexUpgradeLabel: settings.fedexUpgradeLabel,
    fedexUpgradePrice: settings.fedexUpgradePrice,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    requestNumber: request.requestNumber,
    items: request.offer.items.map((item, index) =>
      offerItemToPlant(item, index, request.id),
    ),
  };
}

function toResponseDto(
  response: DbCustomerResponse & { items?: Array<{
    id: string;
    requestItemId: string;
    plantName: string;
    choice: string;
    price: number;
    quantity: number;
    customerFacingNotes: string;
    photoUrlsJson: string;
    unavailableReason: string | null;
    fulfillmentType?: string | null;
    linkedProductTitle?: string | null;
    linkedVariantGid?: string | null;
    linkedVariantTitle?: string | null;
    linkedImageUrl?: string | null;
  }> },
  closedAt?: Date | null,
  timeZone?: string | null,
): CustomerOfferResponse {
  const items = (response.items ?? []).map((item) => ({
    offerItemId: item.id,
    sourceItemId: item.requestItemId,
    plantName: item.plantName,
    choice: item.choice as CustomerResponseItemChoice,
    price: item.price,
    quantity: item.quantity,
    lineRevenue:
      item.choice === "accept" ? normalizePrice(item.price) * item.quantity : 0,
    customerNotes: item.customerFacingNotes,
    photoUrls: parsePhotoUrls(item.photoUrlsJson),
    unavailableReason: item.unavailableReason ?? undefined,
    fulfillmentType: resolveFulfillmentType({
      availability: item.choice === "unavailable" ? "not_available" : "available",
      fulfillmentType: item.fulfillmentType,
    }),
    linkedProductTitle: item.linkedProductTitle ?? undefined,
    linkedVariantTitle: item.linkedVariantTitle ?? undefined,
    linkedVariantGid: item.linkedVariantGid ?? undefined,
    linkedImageUrl: item.linkedImageUrl ?? undefined,
  }));

  return {
    requestId: response.requestId,
    requestNumber: response.requestNumber,
    customerName: response.customerName,
    customerEmail: response.customerEmail,
    shopifyCustomerId: response.shopifyCustomerId ?? undefined,
    respondedAt: formatCustomerDateTime(response.respondedAt, timeZone),
    respondedAtIso: response.respondedAt.toISOString(),
    offerExpiresAt: response.offerExpiresAt
      ? formatCustomerDateTime(response.offerExpiresAt, timeZone)
      : undefined,
    fedexUpgradeSelected: response.fedexUpgradeSelected,
    fedexUpgradePrice: response.fedexUpgradePrice,
    hasAcceptedPurchasableItems: items.some((item) => item.choice === "accept"),
    items,
    closedAt: closedAt ? formatCustomerDateTime(closedAt, timeZone) : undefined,
  };
}

export async function getCustomerResponse(
  shop: string,
  requestId: string,
): Promise<CustomerOfferResponse | null> {
  const request = await loadRequest(shop, requestId);
  if (!request?.response) return null;

  const withItems = await prisma.customerResponse.findUnique({
    where: { requestId },
    include: { items: { orderBy: OFFER_ITEM_ORDER } },
  });
  if (!withItems) return null;
  const timeZone = await getCustomerTimeZone(shop, request.customerEmail);
  return toResponseDto(withItems, request.closedAt, timeZone);
}

/**
 * The plants a draft order should charge for, read from the frozen snapshots.
 *
 * Name, price, quantity and variant come from the customer's own answer and the
 * weight from the offer it answered, so the order bills what the customer was
 * shown even if the request item has since been edited or the linked listing
 * repriced. Both callers that create a draft order go through here, which is
 * also what keeps the customer's submission and the admin's recovery button
 * building the same order.
 */
export async function acceptedOfferLines(
  shop: string,
  requestId: string,
): Promise<{ items: AcceptedDraftOrderItem[]; holdEndsAt: Date | null }> {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: {
      offer: { include: { items: { orderBy: OFFER_ITEM_ORDER } } },
      response: { include: { items: { orderBy: OFFER_ITEM_ORDER } } },
    },
  });
  if (!request) return { items: [], holdEndsAt: null };

  const offerItems = new Map(
    (request.offer?.items ?? []).map((item) => [item.requestItemId, item]),
  );

  const items = (request.response?.items ?? [])
    .filter((item) => item.choice === "accept")
    .map((item) => {
      const offerItem = offerItems.get(item.requestItemId);
      return {
        itemId: item.requestItemId,
        plantName: item.plantName,
        quantity: normalizeQuantity(item.quantity),
        price: normalizePrice(item.price),
        weightLbs: normalizeWeight(offerItem?.weightLbs ?? 0),
        ...(item.linkedVariantGid ? { variantId: item.linkedVariantGid } : {}),
      };
    });

  return {
    items,
    holdEndsAt: request.offer?.expiresAt ?? request.response?.offerExpiresAt ?? null,
  };
}

export async function saveCustomerResponse(
  shop: string,
  input: {
    requestId: string;
    items: CustomerResponseItem[];
    fedexUpgradeSelected: boolean;
    fedexUpgradePrice: number;
  },
): Promise<CustomerOfferResponse> {
  const request = await loadRequest(shop, input.requestId);
  if (!request) throw new Error("Request not found.");
  // A Closed request is finished: paid, or closed by the customer. Accepting an
  // answer against one bills for plants nobody is holding and emails a payment
  // link the customer's own page does not show, and it is reachable by posting
  // a stale tab. It also let an Expired request slip past the check below once
  // it had been closed.
  if (normalizeRequestStatus(request.status) === "Closed") {
    throw new RequestClosedError();
  }
  if (normalizeRequestStatus(request.status) === "Expired") {
    throw new OfferExpiredError();
  }

  const snapshot = {
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    shopifyCustomerId: request.shopifyCustomerId,
    requestNumber: request.requestNumber,
    submittedAt: new Date().toISOString(),
    offerExpiresAt: request.offer?.expiresAt.toISOString() ?? null,
    fedexUpgradeSelected: input.fedexUpgradeSelected,
    items: input.items,
  };

  // Create-only. `CustomerResponse.requestId` is unique, so two concurrent
  // submissions cannot both record a response, and the loser is reported as an
  // already-answered offer rather than silently overwriting the first answer.
  try {
    const saved = await prisma.customerResponse.create({
      data: {
        requestId: input.requestId,
        customerName: request.customerName,
        customerEmail: request.customerEmail,
        shopifyCustomerId: request.shopifyCustomerId,
        requestNumber: request.requestNumber,
        offerExpiresAt: request.offer?.expiresAt,
        fedexUpgradeSelected: input.fedexUpgradeSelected,
        fedexUpgradePrice: input.fedexUpgradePrice,
        snapshotJson: JSON.stringify(snapshot),
        items: {
          create: input.items.map((item) => ({
            requestItemId: item.sourceItemId,
            plantName: item.plantName,
            choice: item.choice,
            price: item.price,
            quantity: item.quantity,
            customerFacingNotes: item.customerNotes,
            photoUrlsJson: JSON.stringify(item.photoUrls ?? []),
            unavailableReason: item.unavailableReason,
            // Carried across from the offer the customer was looking at, not
            // read from the request item. The variant recorded here is the one
            // the draft order bills and reserves, so a relink after the answer
            // must not move it.
            fulfillmentType: normalizeStoredFulfillmentType(item.fulfillmentType),
            linkedProductTitle: item.linkedProductTitle,
            linkedVariantGid: item.linkedVariantGid,
            linkedVariantTitle: item.linkedVariantTitle,
            linkedImageUrl: item.linkedImageUrl,
          })),
        },
      },
      include: { items: true },
    });

    const timeZone = await getCustomerTimeZone(shop, request.customerEmail);
    return toResponseDto(saved, request.closedAt, timeZone);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new OfferAlreadyAnsweredError();
    }
    throw error;
  }
}

export async function requestHasEventReason(
  shop: string,
  requestId: string,
  reason: string,
): Promise<boolean> {
  const event = await prisma.statusEvent.findFirst({
    where: { requestId, reason, request: { shop } },
    select: { id: true },
  });
  return Boolean(event);
}

export async function closeRequest(
  shop: string,
  requestId: string,
  reason: string,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;

  // Already closed: keep the original closedAt and do not append another event.
  if (normalizeRequestStatus(request.status) === "Closed") {
    return toPlantRequest(request);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.plantRequest.update({
      where: { id: requestId },
      data: { status: "Closed", closedAt: now },
    }),
    prisma.statusEvent.create({
      data: {
        requestId,
        fromStatus: request.status,
        toStatus: "Closed",
        reason,
      },
    }),
  ]);

  return getRequest(shop, requestId);
}

export async function markRequestPaid(
  shop: string,
  requestId: string,
  order: {
    shopifyOrderGid: string;
    orderNumber?: string;
    plantRevenue: number;
  },
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;

  // `orders/paid` is delivered at least once. Redelivery of an order we have
  // already recorded must not re-close the request or append a second event.
  const existingOrder = await prisma.shopifyOrderReference.findUnique({
    where: { requestId },
  });
  if (existingOrder?.shopifyOrderGid === order.shopifyOrderGid && request.paidAt) {
    return toPlantRequest(request);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Two copies of the same delivery can both read paidAt as null before
    // either writes — Shopify delivers at least once and more than one instance
    // may be running. Claiming the row decides which one owns the close, so the
    // history gets a single "Payment completed" entry rather than one per copy.
    const claim = await tx.plantRequest.updateMany({
      where: { id: requestId, shop, paidAt: null },
      data: { status: "Closed", closedAt: request.closedAt ?? now, paidAt: now },
    });
    const alreadyPaid = claim.count === 0;
    await tx.shopifyOrderReference.upsert({
      where: { requestId },
      create: {
        requestId,
        shopifyOrderGid: order.shopifyOrderGid,
        orderNumber: order.orderNumber,
        paidAt: now,
        plantRevenue: order.plantRevenue,
      },
      update: {
        shopifyOrderGid: order.shopifyOrderGid,
        orderNumber: order.orderNumber,
        paidAt: now,
        plantRevenue: order.plantRevenue,
      },
    });
    if (request.draftOrder) {
      await tx.draftOrderReference.update({
        where: { requestId },
        data: { paidAt: now },
      });
    }
    const acceptedIds = (
      await tx.responseItem.findMany({
        where: { response: { requestId }, choice: "accept" },
        select: { requestItemId: true },
      })
    ).map((item) => item.requestItemId);
    if (acceptedIds.length > 0) {
      await tx.requestItem.updateMany({
        where: { id: { in: acceptedIds } },
        data: { itemStatus: "Sold", purchasedAt: now },
      });
    }
    if (!alreadyPaid) {
      const afterVoid =
        Boolean(request.draftOrder?.voidedAt) || request.status === "Expired";
      await tx.statusEvent.create({
        data: {
          requestId,
          fromStatus: request.status,
          toStatus: "Closed",
          reason: afterVoid
            ? PAYMENT_AFTER_VOID_REASON
            : "Payment completed",
        },
      });
    }
  });

  return getRequest(shop, requestId);
}

export async function saveDraftOrderReference(
  shop: string,
  requestId: string,
  data: {
    shopifyDraftOrderGid?: string;
    invoiceUrl?: string;
    lineItems: DraftOrderLineItem[];
    /** What Shopify confirmed it is holding stock until, when it is. */
    reserveInventoryUntil?: Date;
  },
) {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
  });
  if (!request) throw new Error("Request not found.");

  return prisma.draftOrderReference.upsert({
    where: { requestId },
    create: {
      requestId,
      shopifyDraftOrderGid: data.shopifyDraftOrderGid,
      invoiceUrl: data.invoiceUrl,
      lineItemsJson: JSON.stringify(data.lineItems),
      reserveInventoryUntil: data.reserveInventoryUntil,
    },
    update: {
      shopifyDraftOrderGid: data.shopifyDraftOrderGid,
      invoiceUrl: data.invoiceUrl,
      lineItemsJson: JSON.stringify(data.lineItems),
      reserveInventoryUntil: data.reserveInventoryUntil,
    },
  });
}

/** How long one attempt at creating a draft order may hold the claim. */
const DRAFT_ORDER_CLAIM_MS = 2 * 60 * 1000;

export class DraftOrderInFlightError extends Error {
  constructor() {
    super(
      "An order for this request is already being created. Refresh the page to see the payment link.",
    );
    this.name = "DraftOrderInFlightError";
  }
}

/**
 * Claims the right to create this request's draft order, or refuses.
 *
 * Reading "no draft order recorded" and creating one are separated by several
 * Shopify round trips, so two submissions — a double click, a retried POST, a
 * webhook redelivery landing beside the customer's own submit, or two instances
 * of the app — can both get through that read. Both would then ask Shopify to
 * hold the same plant, and a Grower's Choice line would be reserved twice
 * against stock of one.
 *
 * The unique index on `requestId` is what makes the claim exclusive: exactly
 * one caller creates the row. A claim older than the window it takes to talk to
 * Shopify is taken over, so an attempt that died mid-flight cannot leave the
 * request permanently unpayable.
 */
export async function claimDraftOrderCreation(
  shop: string,
  requestId: string,
): Promise<void> {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    select: { id: true },
  });
  if (!request) throw new Error("Request not found.");

  try {
    await prisma.draftOrderReference.create({ data: { requestId } });
    return;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const { count } = await prisma.draftOrderReference.updateMany({
    where: {
      requestId,
      invoiceUrl: null,
      createdAt: { lt: new Date(Date.now() - DRAFT_ORDER_CLAIM_MS) },
    },
    data: { createdAt: new Date() },
  });
  if (count === 0) throw new DraftOrderInFlightError();
}

/**
 * Gives the claim back after an attempt that created nothing in Shopify, so the
 * merchant's retry does not have to wait out the window. Only ever removes a
 * row with no checkout link, which is a claim and not a draft order.
 */
export async function releaseDraftOrderClaim(
  shop: string,
  requestId: string,
): Promise<void> {
  await prisma.draftOrderReference.deleteMany({
    where: { requestId, request: { shop }, invoiceUrl: null },
  });
}

export function parseDraftOrderLineItems(raw: string | null | undefined): DraftOrderLineItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as DraftOrderLineItem[];
  } catch {
    return [];
  }
}

export async function getDraftOrder(shop: string, requestId: string) {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: { draftOrder: true },
  });
  return request?.draftOrder ?? null;
}

export async function findRequestByDraftOrderGid(draftOrderGid: string) {
  return prisma.draftOrderReference.findFirst({
    where: { shopifyDraftOrderGid: draftOrderGid },
    include: { request: true },
  });
}

export async function findRequestByNumber(shop: string, requestNumber: string) {
  const exact = await prisma.plantRequest.findFirst({
    where: { shop, requestNumber },
  });
  if (exact) return exact;

  const parsed = parseRequestNumber(requestNumber);
  if (parsed == null) return null;

  const year = new Date().getFullYear();
  const padded = String(parsed).padStart(6, "0");
  const candidates = [
    formatRequestNumber(parsed),
    `UPT-REQ-${year}-${padded}`,
    `UPT-REQ-${year - 1}-${padded}`,
  ];

  return prisma.plantRequest.findFirst({
    where: { shop, requestNumber: { in: candidates } },
  });
}
