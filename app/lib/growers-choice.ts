/**
 * Grower's Choice: a plant supplied from stock the store already lists, rather
 * than one specific plant sourced and photographed for one customer.
 *
 * Deliberately free of imports. `portal.ts` reads this vocabulary to decide
 * whether an offer can be sent, so anything imported here would pull `portal.ts`
 * back in a circle.
 */

/** How UPT means to supply a plant, as it is stored on the request item. */
export type StoredFulfillmentType = "exact_plant" | "growers_choice";

/**
 * How UPT means to supply a plant once availability is taken into account.
 *
 * `not_available` is never stored: it lives in `availability`, which the offer
 * snapshot, the customer page, the EXACT PLANTS queue and analytics all already
 * read. Storing it twice is how the two come to disagree.
 */
export type FulfillmentType = StoredFulfillmentType | "not_available";

export const STORED_FULFILLMENT_TYPES: StoredFulfillmentType[] = [
  "exact_plant",
  "growers_choice",
];

export const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  exact_plant: "Exact Plant",
  growers_choice: "Grower's Choice",
  not_available: "Not Available",
};

/** The three things the admin chooses between on a request item. */
export const FULFILLMENT_CHOICE_LABELS: Record<FulfillmentType, string> = {
  exact_plant: "Offer Exact Plant",
  growers_choice: "Link Existing Website Stock",
  not_available: "Not Available",
};

export function normalizeStoredFulfillmentType(
  raw: string | null | undefined,
): StoredFulfillmentType {
  return raw === "growers_choice" ? "growers_choice" : "exact_plant";
}

/**
 * The route a line is actually on. Not Available wins over anything stored:
 * a plant UPT cannot supply is not being supplied either way, and leaving a
 * stale `growers_choice` to decide would put it back in the draft order.
 */
export function resolveFulfillmentType(input: {
  availability: string | null | undefined;
  fulfillmentType?: string | null;
}): FulfillmentType {
  if (input.availability === "not_available") return "not_available";
  return normalizeStoredFulfillmentType(input.fulfillmentType);
}

export function isGrowersChoice(input: {
  availability: string | null | undefined;
  fulfillmentType?: string | null;
}): boolean {
  return resolveFulfillmentType(input) === "growers_choice";
}

/**
 * Why the picture is not the plant.
 *
 * A Grower's Choice customer receives a plant of the kind the listing sells,
 * not the individual that was photographed for it. That has to be said beside
 * the photo: an exact-plant offer on the same page shows the very plant being
 * bought, so an unlabelled listing photo reads as the same promise.
 */
export const GROWERS_CHOICE_IMAGE_DISCLOSURE =
  "This photo is from our existing store listing, not of the plant you will receive. " +
  "Grower's Choice means we choose a healthy plant of this kind for you, so yours will be similar but not identical to the one pictured.";

/** What the customer is told a Grower's Choice line is, in one line. */
export const GROWERS_CHOICE_CUSTOMER_SUMMARY =
  "Supplied from our existing website stock. We pick the plant for you.";

/** One purchasable variant, as the admin product search returns it. */
export type StockVariantCandidate = {
  productGid: string;
  productTitle: string;
  productHandle: string;
  /** Shopify `ProductStatus`; only an ACTIVE product can be sold. */
  productStatus: string;
  variantGid: string;
  variantTitle: string;
  sku: string | null;
  price: number;
  /** Null when Shopify does not track this variant, never zero for that case. */
  inventoryQuantity: number | null;
  inventoryTracked: boolean;
  availableForSale: boolean;
  weightLbs: number | null;
  imageUrl: string | null;
};

/**
 * Why this variant may not be linked, or null when it may be.
 *
 * Untracked stock is allowed and is not the same as stock of zero: Shopify has
 * no counter for it, so there is nothing to be short of and nothing to reserve.
 * The admin is told which of the two they are looking at rather than having the
 * variant quietly withheld.
 */
export function unlinkableVariantReason(
  candidate: StockVariantCandidate,
): string | null {
  if (candidate.productStatus.toUpperCase() !== "ACTIVE") {
    return "This product is not active in Shopify, so a customer could not buy it.";
  }
  if (!(candidate.price > 0)) {
    return "This variant has no price in Shopify.";
  }
  if (candidate.inventoryTracked && (candidate.inventoryQuantity ?? 0) < 1) {
    return "This variant is out of stock.";
  }
  if (!candidate.availableForSale) {
    return "Shopify reports this variant as not available for sale.";
  }
  return null;
}

export function isLinkableVariant(candidate: StockVariantCandidate): boolean {
  return unlinkableVariantReason(candidate) === null;
}

/** How many units short the linked listing is; 0 when there are enough. */
export function linkedStockShortfall(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
  quantity: number;
}): number {
  if (!input.inventoryTracked) return 0;
  const wanted = Math.max(1, Math.floor(input.quantity));
  const held = input.inventoryQuantity ?? 0;
  return held >= wanted ? 0 : wanted - held;
}

/**
 * The weight a Grower's Choice line ships on.
 *
 * The linked variant's own weight is preferred: Shopify already holds a real
 * figure for stock it sells, and the admin has no exact plant on a bench to
 * weigh. The item's weight is the fallback for a variant whose weight the
 * merchant never filled in.
 */
export function resolveLinkedWeightLbs(input: {
  linkedVariantWeightLbs?: number | null;
  weightLbs?: number | null;
}): number {
  const variantWeight = input.linkedVariantWeightLbs ?? 0;
  if (variantWeight > 0) return variantWeight;
  return input.weightLbs ?? 0;
}

const POUNDS_PER_WEIGHT_UNIT: Record<string, number> = {
  POUNDS: 1,
  OUNCES: 1 / 16,
  KILOGRAMS: 2.2046226218,
  GRAMS: 0.0022046226218,
};

/**
 * Shopify stores a variant weight in whichever unit the merchant chose, and the
 * portal prices shipping in pounds throughout. An unknown unit returns null
 * rather than a number that would be wrong by three orders of magnitude.
 */
export function weightInPounds(
  value: number | null | undefined,
  unit: string | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = POUNDS_PER_WEIGHT_UNIT[(unit ?? "").toUpperCase()];
  if (!factor) return null;
  return Math.round(value * factor * 10) / 10;
}

/** Terms shorter than this match most of a catalogue and are not worth asking. */
export const MIN_STOCK_SEARCH_TERM = 2;

/** Words sent to Shopify. Beyond this the query is noise, and every term ANDs. */
const MAX_STOCK_SEARCH_TERMS = 6;

/**
 * A Shopify search query for what the admin typed.
 *
 * Shopify's search syntax reads `:` as a field separator, a leading `-` as NOT
 * and quotes as phrase delimiters, so a merchant typing a cultivar name in
 * quotes or a SKU containing a colon would silently search for something else.
 * Everything that is syntax is dropped and each remaining word gets a trailing
 * `*`, which is the one wildcard Shopify supports — so "monst thai" finds
 * "Monstera Thai Constellation" rather than nothing.
 */
export function buildStockSearchQuery(term: string): string | null {
  const words = term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
    .slice(0, MAX_STOCK_SEARCH_TERMS);

  if (words.length === 0) return null;
  if (words.join("").length < MIN_STOCK_SEARCH_TERM) return null;
  return words.map((word) => `${word}*`).join(" ");
}

/** A linked variant as Shopify reports it at the moment of asking. */
export type LiveVariantStock = {
  variantGid: string;
  productStatus: string;
  availableForSale: boolean;
  inventoryTracked: boolean;
  inventoryQuantity: number | null;
};

/** One accepted plant that needs stock held for it. */
export type ReservationRequest = {
  itemId: string;
  plantName: string;
  variantGid: string;
  quantity: number;
};

export type ReservationShortfall = {
  itemId: string;
  plantName: string;
  variantGid: string;
  reason: string;
};

/**
 * The accepted plants whose stock is no longer there to hold.
 *
 * Read immediately before the draft order asks Shopify for the reservation.
 * Quantities are summed per variant first, because two accepted lines pointing
 * at one listing need two units between them and checking each against the same
 * single unit would pass both.
 *
 * This is a courtesy, not the guarantee. Anyone can buy the last plant in the
 * moment between this answer and the reservation, so the thing that actually
 * prevents an oversell is Shopify refusing the reservation. What this buys is a
 * failure the merchant can read, naming the plant, instead of a draft order
 * that quietly holds nothing.
 */
export function reservationShortfalls(
  requested: ReservationRequest[],
  live: LiveVariantStock[],
): ReservationShortfall[] {
  const stock = new Map(live.map((entry) => [entry.variantGid, entry]));
  const wantedPerVariant = new Map<string, number>();
  for (const line of requested) {
    wantedPerVariant.set(
      line.variantGid,
      (wantedPerVariant.get(line.variantGid) ?? 0) + Math.max(1, Math.floor(line.quantity)),
    );
  }

  const reported = new Set<string>();
  const shortfalls: ReservationShortfall[] = [];

  for (const line of requested) {
    if (reported.has(line.variantGid)) continue;
    const variant = stock.get(line.variantGid);
    const wanted = wantedPerVariant.get(line.variantGid) ?? 1;

    const reason = !variant
      ? "the linked Shopify listing no longer exists"
      : variant.productStatus.toUpperCase() !== "ACTIVE"
        ? "its Shopify product is no longer active"
        : linkedStockShortfall({
              inventoryTracked: variant.inventoryTracked,
              inventoryQuantity: variant.inventoryQuantity,
              quantity: wanted,
            }) > 0
          ? `only ${variant.inventoryQuantity ?? 0} of the ${wanted} needed ${
              wanted === 1 ? "is" : "are"
            } left in stock`
          : !variant.availableForSale
            ? "Shopify reports it as no longer available for sale"
            : null;

    if (!reason) continue;
    reported.add(line.variantGid);
    shortfalls.push({
      itemId: line.itemId,
      plantName: line.plantName,
      variantGid: line.variantGid,
      reason: `${line.plantName}: ${reason}.`,
    });
  }

  return shortfalls;
}

/** What the admin is told when the stock went before it could be held. */
export function reservationFailureMessage(
  shortfalls: ReservationShortfall[],
): string {
  return (
    "The customer's answer is saved, but the existing website stock behind " +
    (shortfalls.length === 1 ? "one accepted plant" : `${shortfalls.length} accepted plants`) +
    " could no longer be held, so no order was created and nothing has been charged. " +
    shortfalls.map((shortfall) => shortfall.reason).join(" ") +
    " Restock the listing or offer the customer an alternative, then create the payment link."
  );
}

/**
 * Said when Shopify accepted the draft order but did not come back holding the
 * stock. The customer can still pay, so the order is not undone — but nobody
 * may be left believing the plant is spoken for when it is on open sale.
 */
export const RESERVATION_NOT_CONFIRMED =
  "Shopify created the order but did not confirm a stock reservation for the linked listing, " +
  "so this plant is still on open sale and another customer could buy it first. Check the listing's stock.";

/** Whether Shopify is still holding stock for a draft order. */
export type InventoryHoldState = "none" | "held" | "released" | "purchased";

/**
 * Shopify releases the hold by itself at `reserveInventoryUntil` and turns it
 * into a real deduction when the order is paid, so nothing in the portal has to
 * put a quantity back. This reads which of those has happened, for the request
 * page and for the sweep that expires the offer at the same moment.
 */
export function inventoryHoldState(input: {
  reserveInventoryUntil?: Date | string | null;
  paidAt?: Date | string | null;
  now?: Date;
}): InventoryHoldState {
  if (input.paidAt) return "purchased";
  if (!input.reserveInventoryUntil) return "none";
  const until = new Date(input.reserveInventoryUntil);
  if (!Number.isFinite(until.getTime())) return "none";
  return until.getTime() > (input.now ?? new Date()).getTime() ? "held" : "released";
}

/**
 * How the admin request page describes the stock behind a linked item.
 * "Not tracked" and "0 in stock" mean very different things to whoever is about
 * to send the offer.
 */
export function formatLinkedInventory(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
}): string {
  if (!input.inventoryTracked) {
    return "Inventory not tracked in Shopify";
  }
  const quantity = input.inventoryQuantity ?? 0;
  return `${quantity} in stock`;
}
