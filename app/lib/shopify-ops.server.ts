import type { AdminContext } from "./admin-auth.server";
import { customerLinksForShop } from "./customer-links.server";
import {
  buildExactPlantInventoryInput,
  buildExactPlantVariantInput,
  declinedItemTag,
  exactPlantMediaError,
  EXACT_PLANT_STOCK_QUANTITY,
  EXACT_PLANTS_COLLECTION_TITLE,
  isOnlineStorePublicationHandle,
  isPosPublicationHandle,
  ONLINE_STORE_APP_HANDLE,
  planExactPlantMedia,
  POS_APP_HANDLES,
  buildExactPlantProductCreateInput,
  type ExistingProductMedia,
} from "./exact-plants";
import {
  availableQuantityFromLevel,
  exactPlantInventoryIdempotencyKey,
  INVENTORY_RETRY_DELAY_MS,
  isConcurrentIdempotencyError,
  isPreviousAttemptFailedIdempotencyError,
  isStaleInventoryError,
  MAX_INVENTORY_MUTATION_ATTEMPTS,
  type InventoryUserError,
} from "./inventory-concurrency";
import { canStubShopifyWrites, requireAdminClient } from "./environment.server";
import {
  isEligibleStockSearchResult,
  reservationFailureMessage,
  reservationShortfalls,
  stockSearchShopifyQuery,
  weightInPounds,
  type ReservationShortfall,
  type StockVariantCandidate,
} from "./growers-choice";
import {
  buildDraftOrderInput,
  buildDraftOrderLineItems,
  draftOrderIdempotencyTag,
  FEDEX_PRODUCT_HANDLE,
  FEDEX_PRODUCT_SKU,
  fedexVariantSkuQuery,
  plantRevenueFromLines,
  reserveInventoryUntilFor,
  tagSearchQuery,
  type AcceptedDraftOrderItem,
  type DraftOrderLineItem,
} from "./portal";
import {
  claimDraftOrderCreation,
  getDraftOrder,
  getShopSettings,
  parseDraftOrderLineItems,
  releaseDraftOrderClaim,
  saveDraftOrderReference,
  updateShopSettings,
} from "./portal.server";

export type GraphqlClient = NonNullable<AdminContext["admin"]>;

async function adminGraphql<T>(
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  if (!json.data) {
    throw new Error("Shopify Admin API returned no data.");
  }
  return json.data;
}

const FEDEX_VARIANT_BY_SKU_QUERY = `#graphql
  query FedexUpgradeVariantBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      nodes { id sku price }
    }
  }
`;

const FEDEX_PRODUCT_BY_HANDLE_QUERY = `#graphql
  query FedexUpgradeProduct($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      variants(first: 1) {
        nodes { id price }
      }
    }
  }
`;

type FedexVariantNode = { id: string; price: string };

async function persistFedexVariant(
  shop: string,
  variant: FedexVariantNode,
  fallbackPrice: number,
): Promise<{ variantGid: string; price: number }> {
  const price = Number.parseFloat(variant.price) || fallbackPrice;
  // The stored price is what the offer quotes, the confirmation email states
  // and the response snapshot freezes. Nothing else ever wrote it, so it sat
  // at its default of 15 while Shopify billed the live variant price.
  await updateShopSettings(shop, {
    fedexVariantGid: variant.id,
    fedexUpgradePrice: price,
  });
  return { variantGid: variant.id, price };
}

export async function resolveFedexVariant(
  admin: GraphqlClient | undefined,
  shop: string,
): Promise<{ variantGid?: string; price: number }> {
  const settings = await getShopSettings(shop);
  if (!admin) {
    return { variantGid: settings.fedexVariantGid ?? undefined, price: settings.fedexUpgradePrice };
  }

  // Live UPT listing is identified by SKU. Handle is only a fallback for
  // stores that do not carry that SKU (dev/demo).
  const skuData = await adminGraphql<{
    productVariants: { nodes: Array<FedexVariantNode & { sku?: string }> };
  }>(admin, FEDEX_VARIANT_BY_SKU_QUERY, {
    query: fedexVariantSkuQuery(FEDEX_PRODUCT_SKU),
  });
  const skuVariant = skuData.productVariants.nodes[0];
  if (skuVariant) {
    return persistFedexVariant(shop, skuVariant, settings.fedexUpgradePrice);
  }

  const handleData = await adminGraphql<{
    productByIdentifier: {
      variants: { nodes: FedexVariantNode[] };
    } | null;
  }>(admin, FEDEX_PRODUCT_BY_HANDLE_QUERY, {
    identifier: { handle: settings.fedexProductHandle || FEDEX_PRODUCT_HANDLE },
  });

  const handleVariant = handleData.productByIdentifier?.variants.nodes[0];
  if (handleVariant) {
    return persistFedexVariant(shop, handleVariant, settings.fedexUpgradePrice);
  }

  return { variantGid: settings.fedexVariantGid ?? undefined, price: settings.fedexUpgradePrice };
}

/**
 * Brings the stored FedEx upgrade price back in line with Shopify before an
 * offer freezes it.
 *
 * Best effort: quoting a stale price is bad, but refusing to send the offer at
 * all because Shopify is unreachable is worse.
 */
export async function refreshFedexUpgradePrice(
  admin: GraphqlClient | undefined,
  shop: string,
): Promise<void> {
  if (!admin) return;
  try {
    await resolveFedexVariant(admin, shop);
  } catch (error) {
    console.error(
      `Could not refresh the FedEx upgrade price for ${shop}; the offer will quote the stored price.`,
      error,
    );
  }
}

/**
 * Custom draft-order line items need an explicit currency, so the store's
 * currency has to be read before prices can be set. Cached per process because
 * a store's currency effectively never changes.
 */
const shopCurrencyCache = new Map<string, string>();

export async function resolveShopCurrency(
  admin: GraphqlClient,
  shop: string,
): Promise<string> {
  const cached = shopCurrencyCache.get(shop);
  if (cached) return cached;

  const data = await adminGraphql<{ shop: { currencyCode: string } }>(
    admin,
    `#graphql
      query PortalShopCurrency {
        shop { currencyCode }
      }
    `,
  );
  shopCurrencyCache.set(shop, data.shop.currencyCode);
  return data.shop.currencyCode;
}

/**
 * Shopify's search syntax, one term per word, and the two root fields it has to
 * be asked against.
 *
 * `products` covers the product's own text — title, type, vendor, tags, body
 * and its variants' SKUs — and `productVariants` covers a variant title that
 * the product-level search does not reach, which on a plant store is where the
 * size lives ("6 inch", "XL"). Both are asked in one document, so the admin's
 * keystroke costs one round trip, and the results are merged on variant id.
 */
const STOCK_SEARCH_QUERY = `#graphql
  query PortalStockSearch($query: String!, $limit: Int!, $onlineStorePublicationId: ID!) {
    products(first: $limit, query: $query) {
      nodes {
        variants(first: $limit) {
          nodes {
            id
            title
            sku
            price
            availableForSale
            inventoryQuantity
            inventoryItem {
              tracked
              measurement { weight { value unit } }
            }
            media(first: 1) {
              nodes { preview { image { url } } }
            }
            product {
              id
              title
              handle
              status
              publishedOnPublication(publicationId: $onlineStorePublicationId)
              featuredMedia { preview { image { url } } }
            }
          }
        }
      }
    }
    productVariants(first: $limit, query: $query) {
      nodes {
        id
        title
        sku
        price
        availableForSale
        inventoryQuantity
        inventoryItem {
          tracked
          measurement { weight { value unit } }
        }
        media(first: 1) {
          nodes { preview { image { url } } }
        }
        product {
          id
          title
          handle
          status
          publishedOnPublication(publicationId: $onlineStorePublicationId)
          featuredMedia { preview { image { url } } }
        }
      }
    }
  }
`;

/**
 * The same variant fields read straight back by id.
 *
 * Used both when the admin links a variant and immediately before a draft order
 * asks Shopify to hold it. The linking path re-reads rather than trusting the
 * search result the browser posted back: that page may have been open for an
 * hour, and price and stock are exactly what decides whether the variant can be
 * sold at all.
 */
const STOCK_VARIANTS_BY_ID_QUERY = `#graphql
  query PortalStockVariantsById($ids: [ID!]!, $onlineStorePublicationId: ID!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        sku
        price
        availableForSale
        inventoryQuantity
        inventoryItem {
          tracked
          measurement { weight { value unit } }
        }
        media(first: 1) {
          nodes { preview { image { url } } }
        }
        product {
          id
          title
          handle
          status
          publishedOnPublication(publicationId: $onlineStorePublicationId)
          featuredMedia { preview { image { url } } }
        }
      }
    }
  }
`;

type StockVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryItem: {
    tracked: boolean;
    measurement: { weight: { value: number; unit: string } | null };
  };
  media: { nodes: Array<{ preview: { image: { url: string | null } | null } | null }> };
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
    publishedOnPublication: boolean;
    featuredMedia: { preview: { image: { url: string | null } | null } | null } | null;
  };
};

/**
 * The variant's own photo where it has one, otherwise the product's.
 *
 * A plant listing sold in three sizes usually photographs each size, and that
 * is the picture the customer should be shown for the size they are being
 * offered. `preview.image` is read rather than the deprecated `image` fields,
 * which Shopify still serves but is removing.
 */
function stockImageUrl(node: StockVariantNode): string | null {
  return (
    node.media.nodes[0]?.preview?.image?.url ??
    node.product.featuredMedia?.preview?.image?.url ??
    null
  );
}

function toStockCandidate(node: StockVariantNode): StockVariantCandidate {
  const weight = node.inventoryItem.measurement.weight;
  return {
    productGid: node.product.id,
    productTitle: node.product.title,
    productHandle: node.product.handle,
    productStatus: node.product.status,
    publishedOnOnlineStore: node.product.publishedOnPublication,
    variantGid: node.id,
    variantTitle: node.title,
    sku: node.sku,
    price: Number.parseFloat(node.price) || 0,
    // Shopify returns null for a variant it does not count, which is not the
    // same as a variant it counts and finds none of.
    inventoryQuantity: node.inventoryItem.tracked
      ? (node.inventoryQuantity ?? 0)
      : null,
    inventoryTracked: node.inventoryItem.tracked,
    availableForSale: node.availableForSale,
    weightLbs: weightInPounds(weight?.value, weight?.unit),
    imageUrl: stockImageUrl(node),
  };
}

/** How many variants one search asks Shopify for, per root field. */
const STOCK_SEARCH_LIMIT = 25;

/**
 * A stand-in catalogue for the demo shop, which has no Admin API session.
 *
 * The local walkthrough would otherwise have no way to exercise linking at all.
 * Unreachable on a merchant store: `requireAdminClient` raises there instead.
 */
const DEMO_STOCK: StockVariantCandidate[] = [
  {
    productGid: "gid://shopify/Product/demo-monstera-thai",
    productTitle: "Monstera Thai Constellation (Demo Stock)",
    productHandle: "demo-monstera-thai-constellation",
    productStatus: "ACTIVE",
    publishedOnOnlineStore: true,
    variantGid: "gid://shopify/ProductVariant/demo-monstera-thai-6in",
    variantTitle: "6 inch",
    sku: "DEMO-MTC-6",
    price: 285,
    inventoryQuantity: 4,
    inventoryTracked: true,
    availableForSale: true,
    weightLbs: 4.5,
    imageUrl: "https://picsum.photos/seed/demo-monstera-thai/800/800",
  },
  {
    productGid: "gid://shopify/Product/demo-philodendron-pink",
    productTitle: "Philodendron Pink Princess (Demo Stock)",
    productHandle: "demo-philodendron-pink-princess",
    productStatus: "ACTIVE",
    publishedOnOnlineStore: true,
    variantGid: "gid://shopify/ProductVariant/demo-philodendron-pink-4in",
    variantTitle: "4 inch",
    sku: "DEMO-PPP-4",
    price: 95,
    inventoryQuantity: 1,
    inventoryTracked: true,
    availableForSale: true,
    weightLbs: 2,
    imageUrl: "https://picsum.photos/seed/demo-philodendron-pink/800/800",
  },
  {
    productGid: "gid://shopify/Product/demo-anthurium-warocqueanum",
    productTitle: "Anthurium Warocqueanum (Demo Stock)",
    productHandle: "demo-anthurium-warocqueanum",
    productStatus: "ACTIVE",
    publishedOnOnlineStore: true,
    variantGid: "gid://shopify/ProductVariant/demo-anthurium-waroq-8in",
    variantTitle: "8 inch",
    sku: "DEMO-AWQ-8",
    price: 640,
    inventoryQuantity: 0,
    inventoryTracked: true,
    availableForSale: false,
    weightLbs: 6.5,
    imageUrl: "https://picsum.photos/seed/demo-anthurium-warocqueanum/800/800",
  },
  {
    productGid: "gid://shopify/Product/demo-draft-alocasia",
    productTitle: "Alocasia Dragon Scale (Demo Draft)",
    productHandle: "demo-alocasia-dragon-scale-draft",
    productStatus: "DRAFT",
    publishedOnOnlineStore: false,
    variantGid: "gid://shopify/ProductVariant/demo-draft-alocasia-6in",
    variantTitle: "6 inch",
    sku: "DEMO-ADS-6",
    price: 120,
    inventoryQuantity: 2,
    inventoryTracked: true,
    availableForSale: false,
    weightLbs: 3,
    imageUrl: "https://picsum.photos/seed/demo-draft-alocasia/800/800",
  },
  {
    productGid: "gid://shopify/Product/demo-pos-only-hoyas",
    productTitle: "Hoya Compacta (Demo POS Only)",
    productHandle: "demo-hoya-compacta-pos",
    productStatus: "ACTIVE",
    publishedOnOnlineStore: false,
    variantGid: "gid://shopify/ProductVariant/demo-pos-only-hoya-4in",
    variantTitle: "4 inch",
    sku: "DEMO-HC-4",
    price: 45,
    inventoryQuantity: 6,
    inventoryTracked: true,
    availableForSale: true,
    weightLbs: 1.5,
    imageUrl: "https://picsum.photos/seed/demo-pos-only-hoya/800/800",
  },
];

function demoStockMatches(term: string): StockVariantCandidate[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return DEMO_STOCK.filter((candidate) => {
    const haystack = `${candidate.productTitle} ${candidate.variantTitle} ${
      candidate.sku ?? ""
    }`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * ACTIVE products published to this shop's Online Store, plus any zero-stock
 * variants of those products. Draft, archived, and channel-only listings are
 * dropped here so the website and iOS app cannot show them.
 */
export async function searchExistingStock(
  admin: GraphqlClient | undefined,
  shop: string,
  term: string,
): Promise<StockVariantCandidate[]> {
  const query = stockSearchShopifyQuery(term);
  if (!query) return [];

  requireAdminClient(admin, shop, "Searching Shopify products");
  if (!admin) return demoStockMatches(term).filter(isEligibleStockSearchResult);

  const onlineStorePublicationId = await resolveOnlineStorePublicationId(admin, shop);
  const data = await adminGraphql<{
    products: { nodes: Array<{ variants: { nodes: StockVariantNode[] } }> };
    productVariants: { nodes: StockVariantNode[] };
  }>(admin, STOCK_SEARCH_QUERY, {
    query,
    limit: STOCK_SEARCH_LIMIT,
    onlineStorePublicationId,
  });

  const seen = new Set<string>();
  const candidates: StockVariantCandidate[] = [];
  const nodes = [
    ...data.products.nodes.flatMap((product) => product.variants.nodes),
    ...data.productVariants.nodes,
  ];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const candidate = toStockCandidate(node);
    if (!isEligibleStockSearchResult(candidate)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

async function fetchStockVariants(
  admin: GraphqlClient,
  shop: string,
  variantGids: string[],
): Promise<StockVariantCandidate[]> {
  if (variantGids.length === 0) return [];
  const onlineStorePublicationId = await resolveOnlineStorePublicationId(admin, shop);
  const data = await adminGraphql<{ nodes: Array<StockVariantNode | null> }>(
    admin,
    STOCK_VARIANTS_BY_ID_QUERY,
    { ids: variantGids, onlineStorePublicationId },
  );
  return data.nodes.flatMap((node) => (node ? [toStockCandidate(node)] : []));
}

/**
 * One variant as Shopify has it now, or null when it is gone.
 *
 * The admin's link is recorded from this rather than from the search result the
 * form posted, so a stale page cannot link a plant that sold in the meantime.
 */
export async function getExistingStockVariant(
  admin: GraphqlClient | undefined,
  shop: string,
  variantGid: string,
): Promise<StockVariantCandidate | null> {
  requireAdminClient(admin, shop, "Reading a Shopify product variant");
  if (!admin) {
    return DEMO_STOCK.find((candidate) => candidate.variantGid === variantGid) ?? null;
  }
  const [variant] = await fetchStockVariants(admin, shop, [variantGid]);
  return variant ?? null;
}

/** Raised instead of creating a draft order that would oversell. */
export class InsufficientStockError extends Error {
  readonly shortfalls: ReservationShortfall[];

  constructor(shortfalls: ReservationShortfall[]) {
    super(reservationFailureMessage(shortfalls));
    this.name = "InsufficientStockError";
    this.shortfalls = shortfalls;
  }
}

/**
 * Recovers a draft order that Shopify already created for this request. Covers
 * the window where `draftOrderCreate` succeeded but the reply never reached us,
 * so a retry would otherwise bill the customer twice.
 */
async function findDraftOrderByRequestTag(
  admin: GraphqlClient,
  requestId: string,
): Promise<{
  id: string;
  invoiceUrl: string | null;
  reserveInventoryUntil: string | null;
} | null> {
  const data = await adminGraphql<{
    draftOrders: {
      nodes: Array<{
        id: string;
        invoiceUrl: string | null;
        reserveInventoryUntil: string | null;
      }>;
    };
  }>(
    admin,
    `#graphql
      query PlantRequestDraftOrderByTag($query: String!) {
        draftOrders(first: 1, query: $query) {
          nodes { id invoiceUrl reserveInventoryUntil }
        }
      }
    `,
    { query: tagSearchQuery(draftOrderIdempotencyTag(requestId)) },
  );
  return data.draftOrders.nodes[0] ?? null;
}

export type LiveDraftOrderStatus = {
  id: string;
  status: string;
  invoiceUrl: string | null;
  orderGid: string | null;
};

/**
 * Re-read immediately before deleting. Shopify will happily delete a
 * COMPLETED draft order, which would drop the admin record of a payment that
 * just landed — so COMPLETED is a stop, not a delete.
 */
export async function readDraftOrderStatus(
  admin: GraphqlClient,
  draftOrderGid: string,
): Promise<LiveDraftOrderStatus | null> {
  const data = await adminGraphql<{
    draftOrder: {
      id: string;
      status: string;
      invoiceUrl: string | null;
      order: { id: string } | null;
    } | null;
  }>(
    admin,
    `#graphql
      query PlantRequestDraftOrderStatus($id: ID!) {
        draftOrder(id: $id) {
          id
          status
          invoiceUrl
          order { id }
        }
      }
    `,
    { id: draftOrderGid },
  );
  const draft = data.draftOrder;
  if (!draft) return null;
  return {
    id: draft.id,
    status: draft.status,
    invoiceUrl: draft.invoiceUrl,
    orderGid: draft.order?.id ?? null,
  };
}

export function isDraftOrderGoneError(message: string): boolean {
  return /\b(not found|does not exist|already deleted|resource does not exist)\b/i.test(
    message,
  );
}

/**
 * Makes an issued invoice unpayable. Shopify has no void state; deleting the
 * draft order is the only supported way, and a live store returns 404
 * "This invoice is not available" for the stored checkout URL afterwards.
 *
 * Deleting also releases that draft's `reserved` inventory immediately — the
 * same store showed reserved drop from 1 to 0 on the next read.
 */
export async function deleteDraftOrder(
  admin: GraphqlClient,
  draftOrderGid: string,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const result = await adminGraphql<{
    draftOrderDelete: {
      deletedId: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation DeletePlantRequestDraftOrder($input: DraftOrderDeleteInput!) {
        draftOrderDelete(input: $input) {
          deletedId
          userErrors { field message }
        }
      }
    `,
    { input: { id: draftOrderGid } },
  );

  const errors = result.draftOrderDelete.userErrors;
  if (errors.length > 0) {
    const message = errors.map((error) => error.message).join("; ");
    if (isDraftOrderGoneError(message)) {
      return { deleted: false, alreadyGone: true };
    }
    throw new Error(message);
  }

  return {
    deleted: Boolean(result.draftOrderDelete.deletedId),
    alreadyGone: false,
  };
}

/**
 * Whether Shopify refused the draft order because the stock had gone.
 *
 * `draftOrderCreate` reports it as an ordinary user error, and it is the one
 * user error that has to reach the merchant as a stock problem naming the
 * plant rather than as a generic Shopify failure.
 */
function isInventoryUserError(message: string): boolean {
  return /\b(inventor|stock|out of stock|unavailable quantity)/i.test(message);
}

export async function createDraftOrderForRequest(
  admin: GraphqlClient | undefined,
  shop: string,
  input: {
    requestId: string;
    requestNumber: string;
    customerEmail: string;
    acceptedItems: AcceptedDraftOrderItem[];
    fedexSelected: boolean;
    /** The upgrade price frozen into the customer's response. */
    fedexPrice?: number;
    /**
     * When the customer's payment deadline runs out. Shopify holds the stock
     * behind a Grower's Choice line until exactly this moment and then releases
     * it, so it must be the offer's own expiry and not a window of its own.
     */
    holdEndsAt?: Date | string | null;
    /** Custom shipping line on the invoice. Undefined leaves Shopify's rate. */
    shippingFeeOverride?: number;
  },
): Promise<{
  invoiceUrl: string;
  shopifyDraftOrderGid?: string;
  lineItems: DraftOrderLineItem[];
  reserveInventoryUntil?: Date;
  /** False when stock was asked for and Shopify did not confirm holding it. */
  inventoryReserved: boolean;
}> {
  // A draft order already recorded for this request is authoritative. Never
  // create a second one — and never re-check or re-ask for stock, because the
  // hold this request is entitled to has already been taken and asking again
  // would read our own reservation as somebody else's sale.
  //
  // The checkout link is what marks the row as a real draft order rather than a
  // claim: it is only ever written once Shopify has returned one.
  const recorded = await getDraftOrder(shop, input.requestId);
  if (recorded?.invoiceUrl) {
    return {
      invoiceUrl: recorded.invoiceUrl,
      shopifyDraftOrderGid: recorded.shopifyDraftOrderGid ?? undefined,
      lineItems: parseDraftOrderLineItems(recorded.lineItemsJson),
      reserveInventoryUntil: recorded.reserveInventoryUntil ?? undefined,
      inventoryReserved: Boolean(recorded.reserveInventoryUntil),
    };
  }

  const settings = await getShopSettings(shop);
  const fedex = input.fedexSelected
    ? await resolveFedexVariant(admin, shop)
    : { price: settings.fedexUpgradePrice };

  const lineItems = buildDraftOrderLineItems({
    acceptedItems: input.acceptedItems,
    fedexSelected: input.fedexSelected,
    fedexLabel: settings.fedexUpgradeLabel,
    fedexPrice: input.fedexPrice ?? fedex.price,
    fedexVariantGid: fedex.variantGid,
  });

  if (lineItems.length === 0) {
    throw new Error("Cannot create a draft order with no accepted plant items.");
  }

  const reserveInventoryUntil = reserveInventoryUntilFor({
    lineItems,
    holdEndsAt: input.holdEndsAt,
  });

  requireAdminClient(admin, shop, "Creating a Shopify draft order");

  // Exclusive from here on. Everything below either creates a draft order in
  // Shopify or reserves stock, and a second caller doing it concurrently would
  // hold the same plant twice.
  await claimDraftOrderCreation(shop, input.requestId);

  try {
    return await createClaimedDraftOrder(admin, shop, {
      ...input,
      lineItems,
      reserveInventoryUntil,
    });
  } catch (error) {
    // Nothing was created, so the claim is only in the way of the retry the
    // merchant is about to make.
    await releaseDraftOrderClaim(shop, input.requestId);
    throw error;
  }
}

async function createClaimedDraftOrder(
  admin: GraphqlClient | undefined,
  shop: string,
  input: {
    requestId: string;
    requestNumber: string;
    customerEmail: string;
    acceptedItems: AcceptedDraftOrderItem[];
    lineItems: DraftOrderLineItem[];
    reserveInventoryUntil?: string;
    shippingFeeOverride?: number;
  },
): Promise<{
  invoiceUrl: string;
  shopifyDraftOrderGid?: string;
  lineItems: DraftOrderLineItem[];
  reserveInventoryUntil?: Date;
  inventoryReserved: boolean;
}> {
  const { lineItems, reserveInventoryUntil } = input;
  let shopifyDraftOrderGid: string | undefined;
  let invoiceUrl: string | undefined;
  let reservedUntil: string | undefined;

  if (admin) {
    // Shopify may already hold a draft order for this request if an earlier
    // attempt's reply never reached us. Reusing it is what stops a retry from
    // billing the customer twice.
    const existing = await findDraftOrderByRequestTag(admin, input.requestId);
    if (existing) {
      shopifyDraftOrderGid = existing.id;
      invoiceUrl = existing.invoiceUrl ?? undefined;
      reservedUntil = existing.reserveInventoryUntil ?? undefined;
    } else {
      await assertLinkedStockStillAvailable(admin, shop, input.acceptedItems);

      const draftInput = buildDraftOrderInput({
        requestId: input.requestId,
        requestNumber: input.requestNumber,
        customerEmail: input.customerEmail,
        currencyCode: await resolveShopCurrency(admin, shop),
        lineItems,
        reserveInventoryUntil,
        shippingFeeOverride: input.shippingFeeOverride,
      });

      const created = await adminGraphql<{
        draftOrderCreate: {
          draftOrder: {
            id: string;
            invoiceUrl: string | null;
            reserveInventoryUntil: string | null;
          } | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(
        admin,
        `#graphql
          mutation CreatePlantRequestDraftOrder($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id invoiceUrl reserveInventoryUntil }
              userErrors { field message }
            }
          }
        `,
        { input: draftInput },
      );

      const errors = created.draftOrderCreate.userErrors;
      if (errors.length > 0) {
        // Shopify is the authority on whether the stock could be held: the
        // check above can only ever have been true a moment ago. When it
        // refuses for that reason nothing is created, which is the outcome that
        // matters — the plant is not sold twice.
        const message = errors.map((error) => error.message).join("; ");
        if (isInventoryUserError(message)) {
          throw new InsufficientStockError(
            reservedPlantLines(input.acceptedItems).map((line) => ({
              itemId: line.itemId,
              plantName: line.plantName,
              variantGid: line.variantId,
              reason: `${line.plantName}: Shopify would not hold the stock (${message}).`,
            })),
          );
        }
        throw new Error(message);
      }

      shopifyDraftOrderGid = created.draftOrderCreate.draftOrder?.id;
      invoiceUrl = created.draftOrderCreate.draftOrder?.invoiceUrl ?? undefined;
      reservedUntil =
        created.draftOrderCreate.draftOrder?.reserveInventoryUntil ?? undefined;
    }
  }

  if (!invoiceUrl) {
    // On a real shop a missing checkout link must not be papered over with a
    // placeholder the customer cannot pay.
    if (!canStubShopifyWrites(shop)) {
      throw new Error(
        "Shopify did not return a checkout link for this draft order. The customer's selections were saved; retry once the Admin API is reachable.",
      );
    }
    invoiceUrl = `${customerLinksForShop(shop).requestDetail(input.requestId)}?checkout=pending`;
  }

  // Read back from Shopify rather than assumed from what was sent. A hold that
  // was asked for and not granted leaves the plant on open sale, and the
  // merchant has to be told that instead of a request page claiming it is held.
  const wantedHold = Boolean(reserveInventoryUntil);
  const grantedHold = admin ? Boolean(reservedUntil) : wantedHold;
  const holdEndsAt = reservedUntil ?? reserveInventoryUntil;

  // Recorded as soon as Shopify returns the draft: losing the reference would
  // let a retry create a second one for the same request. The portal never
  // calls draftOrderInvoiceSend — Shopify's automatic invoice email is not
  // wanted; invoiceUrl from draftOrderCreate is the checkout link the portal
  // shows after Accept, and a human recovery action can email it.
  await saveDraftOrderReference(shop, input.requestId, {
    shopifyDraftOrderGid,
    invoiceUrl,
    lineItems,
    reserveInventoryUntil: grantedHold && holdEndsAt ? new Date(holdEndsAt) : undefined,
  });

  return {
    invoiceUrl,
    shopifyDraftOrderGid,
    lineItems,
    reserveInventoryUntil:
      grantedHold && holdEndsAt ? new Date(holdEndsAt) : undefined,
    inventoryReserved: !wantedHold || grantedHold,
  };
}

/** The accepted plants that come out of existing store stock. */
function reservedPlantLines(
  acceptedItems: AcceptedDraftOrderItem[],
): Array<AcceptedDraftOrderItem & { variantId: string }> {
  return acceptedItems.flatMap((item) =>
    item.variantId ? [{ ...item, variantId: item.variantId }] : [],
  );
}

/**
 * Refuses the draft order when the stock behind an accepted plant has gone.
 *
 * Only reached on the path that is about to create a new draft order, so it
 * never sees a reservation this request already holds. A retry whose first
 * attempt did reserve is short-circuited before this, either by the recorded
 * reference or by the tag lookup; if both were to miss, this reads the stock
 * our own hold is sitting on and refuses — which errs towards telling the
 * merchant to look rather than towards holding the plant twice.
 */
async function assertLinkedStockStillAvailable(
  admin: GraphqlClient,
  shop: string,
  acceptedItems: AcceptedDraftOrderItem[],
): Promise<void> {
  const lines = reservedPlantLines(acceptedItems);
  if (lines.length === 0) return;

  const live = await fetchStockVariants(admin, shop, [
    ...new Set(lines.map((line) => line.variantId)),
  ]);

  const shortfalls = reservationShortfalls(
    lines.map((line) => ({
      itemId: line.itemId,
      plantName: line.plantName,
      variantGid: line.variantId,
      quantity: line.quantity,
    })),
    live.map((variant) => ({
      variantGid: variant.variantGid,
      productStatus: variant.productStatus,
      availableForSale: variant.availableForSale,
      inventoryTracked: variant.inventoryTracked,
      inventoryQuantity: variant.inventoryQuantity,
    })),
  );

  if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);
}

export { plantRevenueFromLines };

const FILE_CREATE_MUTATION = `#graphql
  mutation CreatePlantPhoto($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        fileErrors { code message }
        ... on MediaImage {
          image { url }
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_STATUS_QUERY = `#graphql
  query PlantPhotoStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        fileErrors { code message }
        image { url }
      }
    }
  }
`;

type ShopifyFileNode = {
  id: string;
  fileStatus: string;
  fileErrors: Array<{ code: string; message: string }>;
  image?: { url?: string | null } | null;
};

const FILE_READY_ATTEMPTS = 10;
const FILE_READY_DELAY_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fileErrorMessage(file: ShopifyFileNode): string {
  const detail = file.fileErrors
    .map((error) => `${error.code}: ${error.message}`)
    .join("; ");
  return detail || "Shopify could not process the uploaded photo.";
}

/**
 * Waits for Shopify to finish processing an uploaded file.
 *
 * `fileCreate` returns immediately with `fileStatus: UPLOADED` and no CDN URL —
 * files are processed asynchronously. Reading `image.url` straight from the
 * mutation response therefore fails intermittently, which is what made photo
 * uploads fall back to local disk.
 */
async function waitForFileUrl(
  admin: GraphqlClient,
  file: ShopifyFileNode,
): Promise<{ url: string; shopifyFileId: string }> {
  let current = file;

  for (let attempt = 0; attempt < FILE_READY_ATTEMPTS; attempt += 1) {
    if (current.fileStatus === "FAILED") {
      throw new Error(fileErrorMessage(current));
    }
    const url = current.image?.url;
    if (current.fileStatus === "READY" && url) {
      return { url, shopifyFileId: current.id };
    }

    await wait(FILE_READY_DELAY_MS);
    const polled = await adminGraphql<{ node: ShopifyFileNode | null }>(
      admin,
      FILE_STATUS_QUERY,
      { id: current.id },
    );
    if (!polled.node) {
      throw new Error("Shopify lost track of the uploaded photo.");
    }
    current = polled.node;
  }

  const url = current.image?.url;
  if (url) return { url, shopifyFileId: current.id };
  throw new Error(
    `Shopify did not finish processing the photo (status ${current.fileStatus}).`,
  );
}

const STAGED_UPLOADS_MUTATION = `#graphql
  mutation StagedPlantPhotoUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

export async function uploadPlantPhoto(
  admin: GraphqlClient | undefined,
  shop: string,
  file: { filename: string; mimeType: string; data: Buffer },
): Promise<{ url: string; shopifyFileId?: string }> {
  requireAdminClient(admin, shop, "Uploading a plant photo to Shopify Files");

  if (!admin) {
    // Demo shop only. A base64 data URL keeps the local walkthrough working but
    // would bloat the database and break Shopify product media in production.
    const encoded = `data:${file.mimeType};base64,${file.data.toString("base64")}`;
    return { url: encoded };
  }

  const staged = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(admin, STAGED_UPLOADS_MUTATION, {
    input: [
      {
        filename: file.filename,
        mimeType: file.mimeType,
        httpMethod: "POST",
        resource: "FILE",
      },
    ],
  });

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) {
    throw new Error(
      staged.stagedUploadsCreate.userErrors.map((error) => error.message).join("; ") ||
        "Shopify staged upload failed.",
    );
  }

  const form = new FormData();
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append(
    "file",
    new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
    file.filename,
  );
  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error("Failed to upload plant photo to Shopify staged target.");
  }

  const created = await adminGraphql<{
    fileCreate: {
      files: Array<ShopifyFileNode | null>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(admin, FILE_CREATE_MUTATION, {
    files: [
      {
        alt: file.filename,
        contentType: "IMAGE",
        originalSource: target.resourceUrl,
      },
    ],
  });

  if (created.fileCreate.userErrors.length > 0) {
    throw new Error(
      created.fileCreate.userErrors.map((error) => error.message).join("; "),
    );
  }

  const uploaded = created.fileCreate.files[0];
  if (!uploaded) {
    throw new Error("Shopify fileCreate returned no file.");
  }

  return waitForFileUrl(admin, uploaded);
}

function userErrorMessage(
  errors: Array<{ message: string }> | undefined,
  fallback: string,
): string {
  const message = errors?.map((error) => error.message).filter(Boolean).join("; ");
  return message || fallback;
}

type ExactPlantProduct = {
  id: string;
  handle: string;
  variantId?: string;
  inventoryItemId?: string;
};

export async function findExactPlantProductByItemTag(
  admin: GraphqlClient,
  requestItemId: string,
): Promise<ExactPlantProduct | null> {
  const tag = declinedItemTag(requestItemId);
  const data = await adminGraphql<{
    products: {
      nodes: Array<{
        id: string;
        handle: string;
        variants: {
          nodes: Array<{ id: string; inventoryItem: { id: string } }>;
        };
      }>;
    };
  }>(
    admin,
    `#graphql
      query ExactPlantProductByTag($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            handle
            variants(first: 1) {
              nodes {
                id
                inventoryItem { id }
              }
            }
          }
        }
      }
    `,
    { query: tagSearchQuery(tag) },
  );

  const product = data.products.nodes[0];
  if (!product) return null;
  const variant = product.variants.nodes[0];
  return {
    id: product.id,
    handle: product.handle,
    variantId: variant?.id,
    inventoryItemId: variant?.inventoryItem.id,
  };
}

export async function findOrCreateExactPlantsCollection(
  admin: GraphqlClient,
): Promise<{ id: string; title: string; handle: string }> {
  const existing = await adminGraphql<{
    collections: {
      nodes: Array<{ id: string; title: string; handle: string }>;
    };
  }>(
    admin,
    `#graphql
      query ExactPlantsCollection($query: String!) {
        collections(first: 5, query: $query) {
          nodes { id title handle }
        }
      }
    `,
    { query: `title:'${EXACT_PLANTS_COLLECTION_TITLE}'` },
  );

  const match = existing.collections.nodes.find(
    (collection) =>
      collection.title.trim().toLowerCase() ===
      EXACT_PLANTS_COLLECTION_TITLE.toLowerCase(),
  );
  if (match) return match;

  const created = await adminGraphql<{
    collectionCreate: {
      collection: { id: string; title: string; handle: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation CreateExactPlantsCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title handle }
          userErrors { message }
        }
      }
    `,
    { input: { title: EXACT_PLANTS_COLLECTION_TITLE } },
  );

  const collection = created.collectionCreate.collection;
  if (!collection) {
    throw new Error(
      userErrorMessage(
        created.collectionCreate.userErrors,
        "Could not find or create the EXACT PLANTS collection.",
      ),
    );
  }
  return collection;
}

async function addProductToCollection(
  admin: GraphqlClient,
  collectionId: string,
  productId: string,
): Promise<void> {
  const result = await adminGraphql<{
    collectionAddProducts: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation AddExactPlantToCollection($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          userErrors { message }
        }
      }
    `,
    { id: collectionId, productIds: [productId] },
  );
  const errors = result.collectionAddProducts.userErrors.filter(
    (error) => !/already/i.test(error.message),
  );
  if (errors.length > 0) {
    throw new Error(userErrorMessage(errors, "Could not add the product to EXACT PLANTS."));
  }
}

/**
 * `catalogType: APP` is required: without it Shopify returns `catalog: null`
 * for every publication, so nothing ever matched and no listing could be
 * published.
 */
const PUBLICATIONS_QUERY = `#graphql
  query SalesChannelPublications($after: String) {
    publications(first: 50, after: $after, catalogType: APP) {
      nodes {
        id
        catalog {
          ... on AppCatalog {
            apps(first: 1) {
              nodes { handle }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const onlineStorePublicationCache = new Map<string, string>();

/**
 * This shop's Online Store publication, found by the `online_store` app handle
 * — never a hardcoded publication GID and never the catalog title.
 */
export async function resolveOnlineStorePublicationId(
  admin: GraphqlClient,
  shop: string,
): Promise<string> {
  const cached = onlineStorePublicationCache.get(shop);
  if (cached) return cached;

  let after: string | null = null;
  do {
    const data: {
      publications: {
        nodes: Array<{
          id: string;
          catalog?: { apps?: { nodes: Array<{ handle?: string | null }> } } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await adminGraphql(admin, PUBLICATIONS_QUERY, { after });

    for (const publication of data.publications.nodes) {
      const handle = publication.catalog?.apps?.nodes[0]?.handle;
      if (isOnlineStorePublicationHandle(handle)) {
        onlineStorePublicationCache.set(shop, publication.id);
        return publication.id;
      }
    }

    after = data.publications.pageInfo.hasNextPage
      ? data.publications.pageInfo.endCursor
      : null;
  } while (after);

  throw new Error(
    `This store has no Online Store (${ONLINE_STORE_APP_HANDLE}) sales channel publication. ` +
      "Add the Online Store sales channel in Shopify admin under Settings > Apps and sales channels.",
  );
}

export async function resolveOnlineStoreAndPosPublications(
  admin: GraphqlClient,
): Promise<{ onlineStoreId: string; posId: string }> {
  let onlineStoreId: string | undefined;
  let posId: string | undefined;
  let after: string | null = null;

  // A store with many channels and catalogs can push Online Store or POS past
  // the first page, and silently failing to publish is worse than a slow loop.
  do {
    const data: {
      publications: {
        nodes: Array<{
          id: string;
          catalog?: { apps?: { nodes: Array<{ handle?: string | null }> } } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await adminGraphql(admin, PUBLICATIONS_QUERY, { after });

    for (const publication of data.publications.nodes) {
      const handle = publication.catalog?.apps?.nodes[0]?.handle;
      if (!onlineStoreId && isOnlineStorePublicationHandle(handle)) {
        onlineStoreId = publication.id;
      }
      if (!posId && isPosPublicationHandle(handle)) {
        posId = publication.id;
      }
    }

    if (onlineStoreId && posId) break;
    after = data.publications.pageInfo.hasNextPage
      ? data.publications.pageInfo.endCursor
      : null;
  } while (after);

  if (!onlineStoreId || !posId) {
    const missing = [
      !onlineStoreId ? `Online Store (${ONLINE_STORE_APP_HANDLE})` : null,
      !posId ? `POS (${POS_APP_HANDLES.join(" or ")})` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `This store has no ${missing} sales channel publication. ` +
        "Add the sales channel to the store in Shopify admin under Settings > Apps and sales channels, then approve the listing again.",
    );
  }

  return { onlineStoreId, posId };
}

async function publishProductToOnlineStoreAndPos(
  admin: GraphqlClient,
  productId: string,
): Promise<void> {
  const { onlineStoreId, posId } = await resolveOnlineStoreAndPosPublications(admin);
  const result = await adminGraphql<{
    publishablePublish: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation PublishExactPlant($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { message }
        }
      }
    `,
    {
      id: productId,
      input: [{ publicationId: onlineStoreId }, { publicationId: posId }],
    },
  );
  if (result.publishablePublish.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.publishablePublish.userErrors,
        "Could not publish the product to Online Store and POS.",
      ),
    );
  }

  await unpublishExactPlantFromOtherChannels(admin, productId, [onlineStoreId, posId]);
}

/**
 * Removes the listing from any sales channel other than Online Store and POS.
 *
 * Publishing to two channels does not keep a product off the others: a channel
 * set to publish new products automatically picks it up on creation. On the
 * development store Shopify recorded "Product was included on Microsoft
 * Copilot" one second after `productCreate`, attributed to no app, on a product
 * this code had not published anywhere yet. An EXACT PLANTS listing is a single
 * physical plant, so an unintended channel is a place it can be sold twice.
 */
async function unpublishExactPlantFromOtherChannels(
  admin: GraphqlClient,
  productId: string,
  allowedPublicationIds: string[],
): Promise<void> {
  const allowed = new Set(allowedPublicationIds);
  // `resourcePublicationsV2` is the current field and it does not list every
  // channel: on the development store it reported only Online Store and Point
  // of Sale for a product that the deprecated `resourcePublications` — and the
  // store's own event log — showed was also on Microsoft Copilot. The
  // deprecated field is the one telling the truth, so it is the one to ask.
  const result = await adminGraphql<{
    product: {
      resourcePublications: {
        nodes: Array<{ publication: { id: string; catalog: { title: string | null } | null } | null }>;
      };
    } | null;
  }>(
    admin,
    `#graphql
      query ExactPlantPublications($id: ID!) {
        product(id: $id) {
          resourcePublications(first: 50) {
            nodes { publication { id catalog { title } } }
          }
        }
      }
    `,
    { id: productId },
  );

  const unwanted = (result.product?.resourcePublications.nodes ?? [])
    .flatMap((node) => (node.publication ? [node.publication] : []))
    .filter((publication) => !allowed.has(publication.id));
  if (unwanted.length === 0) return;

  const removed = await adminGraphql<{
    publishableUnpublish: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation UnpublishExactPlant($id: ID!, $input: [PublicationInput!]!) {
        publishableUnpublish(id: $id, input: $input) {
          userErrors { message }
        }
      }
    `,
    {
      id: productId,
      input: unwanted.map((publication) => ({ publicationId: publication.id })),
    },
  );

  if (removed.publishableUnpublish.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        removed.publishableUnpublish.userErrors,
        "Could not remove the product from other sales channels.",
      ),
    );
  }

  // Some channels accept the mutation, report no error, and stay published —
  // Microsoft Copilot did on the development store. The app cannot revoke those
  // per product, so the merchant has to turn off "automatically publish new
  // products" on the channel itself. Say which one, or nobody will ever know a
  // single physical plant is listed somewhere it can be sold again.
  console.warn(
    `Removed EXACT PLANTS product ${productId} from ${unwanted.length} unintended ` +
      `sales channel(s): ${unwanted
        .map((publication) => publication.catalog?.title ?? publication.id)
        .join(", ")}. If a listing keeps reappearing on one of these, turn off ` +
      `its "automatically publish new products" setting in the Shopify admin.`,
  );
}

async function setExactPlantVariantPriceAndWeight(
  admin: GraphqlClient,
  productId: string,
  variantId: string,
  price: number,
  weightLbs: number,
): Promise<void> {
  const result = await adminGraphql<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation UpdateExactPlantVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { message }
        }
      }
    `,
    {
      productId,
      variants: [buildExactPlantVariantInput({ variantId, price, weightLbs })],
    },
  );
  if (result.productVariantsBulkUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.productVariantsBulkUpdate.userErrors,
        "Could not set the exact plant price and weight.",
      ),
    );
  }
}

const INVENTORY_TARGET_QUERY = `#graphql
  query ExactPlantInventoryLocation {
    location { id }
  }
`;

const INVENTORY_LEVEL_QUERY = `#graphql
  query ExactPlantInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      inventoryLevel(locationId: $locationId) {
        id
        quantities(names: ["available"]) { name quantity }
      }
    }
  }
`;

const INVENTORY_ACTIVATE_MUTATION = `#graphql
  mutation ActivateExactPlantInventory(
    $inventoryItemId: ID!
    $locationId: ID!
    $available: Int
    $idempotencyKey: String!
  ) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
      available: $available
    ) @idempotent(key: $idempotencyKey) {
      # UserError has no code field; concurrent retries match the message.
      userErrors { message }
    }
  }
`;

const INVENTORY_SET_MUTATION = `#graphql
  mutation StockExactPlant(
    $input: InventorySetQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { code message }
    }
  }
`;

type InventoryLevelSnapshot = {
  id: string;
  quantities: Array<{ name: string; quantity: number }>;
} | null;

async function readExactPlantInventoryLevel(
  admin: GraphqlClient,
  inventoryItemId: string,
  locationId: string,
): Promise<InventoryLevelSnapshot> {
  const level = await adminGraphql<{
    inventoryItem: {
      inventoryLevel: InventoryLevelSnapshot;
    } | null;
  }>(admin, INVENTORY_LEVEL_QUERY, { inventoryItemId, locationId });
  return level.inventoryItem?.inventoryLevel ?? null;
}

function delayInventoryRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, INVENTORY_RETRY_DELAY_MS);
  });
}

async function activateExactPlantInventory(
  admin: GraphqlClient,
  input: {
    inventoryItemId: string;
    locationId: string;
    requestItemId: string;
  },
): Promise<InventoryUserError[]> {
  const idempotencyKey = exactPlantInventoryIdempotencyKey({
    requestItemId: input.requestItemId,
    operation: "activate",
  });
  let lastErrors: InventoryUserError[] = [];
  for (let attempt = 0; attempt < MAX_INVENTORY_MUTATION_ATTEMPTS; attempt += 1) {
    const activated = await adminGraphql<{
      inventoryActivate: { userErrors: InventoryUserError[] };
    }>(admin, INVENTORY_ACTIVATE_MUTATION, {
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId,
      available: EXACT_PLANT_STOCK_QUANTITY,
      idempotencyKey,
    });
    lastErrors = activated.inventoryActivate.userErrors;
    if (lastErrors.length === 0) return [];
    if (
      isConcurrentIdempotencyError(lastErrors) ||
      isPreviousAttemptFailedIdempotencyError(lastErrors)
    ) {
      await delayInventoryRetry();
      continue;
    }
    return lastErrors;
  }
  return lastErrors;
}

async function setExactPlantAvailableQuantity(
  admin: GraphqlClient,
  input: {
    inventoryItemId: string;
    locationId: string;
    requestItemId: string;
    changeFromQuantity: number;
  },
): Promise<InventoryUserError[]> {
  const mutationInput = buildExactPlantInventoryInput({
    inventoryItemId: input.inventoryItemId,
    locationId: input.locationId,
    changeFromQuantity: input.changeFromQuantity,
  });
  const idempotencyKey = exactPlantInventoryIdempotencyKey({
    requestItemId: input.requestItemId,
    operation: "set",
    changeFromQuantity: input.changeFromQuantity,
  });
  let lastErrors: InventoryUserError[] = [];
  for (let attempt = 0; attempt < MAX_INVENTORY_MUTATION_ATTEMPTS; attempt += 1) {
    const result = await adminGraphql<{
      inventorySetQuantities: { userErrors: InventoryUserError[] };
    }>(admin, INVENTORY_SET_MUTATION, {
      input: mutationInput,
      idempotencyKey,
    });
    lastErrors = result.inventorySetQuantities.userErrors;
    if (lastErrors.length === 0) return [];
    if (
      isConcurrentIdempotencyError(lastErrors) ||
      isPreviousAttemptFailedIdempotencyError(lastErrors)
    ) {
      await delayInventoryRetry();
      continue;
    }
    return lastErrors;
  }
  return lastErrors;
}

/**
 * Puts exactly one of this plant in stock at the shop's primary location.
 *
 * An EXACT PLANTS listing is one specific physical plant, so without a tracked
 * quantity three customers can buy the same plant. `inventoryQuantities` on
 * `ProductVariantsBulkInput` is only honoured by `productVariantsBulkCreate`,
 * so the quantity needs its own call; which call depends on whether Shopify
 * has already stocked the item at that location.
 *
 * Only `Location.id` is read, which `write_inventory` covers — every other
 * Location field would additionally require `read_locations`.
 */
async function stockOneExactPlant(
  admin: GraphqlClient,
  inventoryItemId: string,
  requestItemId: string,
): Promise<void> {
  const target = await adminGraphql<{ location: { id: string } | null }>(
    admin,
    INVENTORY_TARGET_QUERY,
  );
  const locationId = target.location?.id;
  if (!locationId) {
    throw new Error(
      "This store has no primary location, so the exact plant cannot be stocked.",
    );
  }

  let level = await readExactPlantInventoryLevel(admin, inventoryItemId, locationId);

  if (!level) {
    const activateErrors = await activateExactPlantInventory(admin, {
      inventoryItemId,
      locationId,
      requestItemId,
    });
    if (activateErrors.length === 0) return;
    // A concurrent listing retry may have activated first. Re-read and set
    // rather than fail the approval that still has to land quantity 1.
    level = await readExactPlantInventoryLevel(admin, inventoryItemId, locationId);
    if (!level) {
      throw new Error(
        userErrorMessage(
          activateErrors,
          "Could not stock the exact plant at the store's primary location.",
        ),
      );
    }
  }

  let lastErrors: InventoryUserError[] = [];
  for (let attempt = 0; attempt < MAX_INVENTORY_MUTATION_ATTEMPTS; attempt += 1) {
    const changeFromQuantity = availableQuantityFromLevel(level.quantities);
    lastErrors = await setExactPlantAvailableQuantity(admin, {
      inventoryItemId,
      locationId,
      requestItemId,
      changeFromQuantity,
    });
    if (lastErrors.length === 0) return;
    if (!isStaleInventoryError(lastErrors)) {
      throw new Error(
        userErrorMessage(lastErrors, "Could not set the exact plant stock to one."),
      );
    }
    level = await readExactPlantInventoryLevel(admin, inventoryItemId, locationId);
    if (!level) {
      throw new Error(
        userErrorMessage(lastErrors, "Could not set the exact plant stock to one."),
      );
    }
  }
  throw new Error(
    userErrorMessage(lastErrors, "Could not set the exact plant stock to one."),
  );
}

const PRODUCT_MEDIA_QUERY = `#graphql
  query ExactPlantProductMedia($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 50, after: $after) {
        nodes {
          id
          ... on MediaImage {
            originalSource { url }
            image { url }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/**
 * `fileUpdate` is what 2025-10 offers in place of the deprecated
 * `productDeleteMedia`. It drops the product's reference to the image rather
 * than deleting the image, which is the safer of the two here: the photos come
 * from Shopify Files and a frozen offer snapshot still shows them to the
 * customer who was offered the plant.
 */
const DETACH_PRODUCT_MEDIA_MUTATION = `#graphql
  mutation DetachExactPlantMedia($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      userErrors { message }
    }
  }
`;

async function listExactPlantProductMedia(
  admin: GraphqlClient,
  productId: string,
): Promise<ExistingProductMedia[]> {
  const media: ExistingProductMedia[] = [];
  let after: string | null = null;

  // Paginated because a photo left off the last page would silently stay
  // published, which is the whole failure being fixed here.
  do {
    const data: {
      product: {
        media: {
          nodes: Array<{
            id: string;
            originalSource?: { url?: string | null } | null;
            image?: { url?: string | null } | null;
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await adminGraphql(admin, PRODUCT_MEDIA_QUERY, { id: productId, after });

    if (!data.product) break;
    for (const node of data.product.media.nodes) {
      media.push({
        id: node.id,
        sourceUrl: node.originalSource?.url ?? null,
        imageUrl: node.image?.url ?? null,
      });
    }
    after = data.product.media.pageInfo.hasNextPage
      ? data.product.media.pageInfo.endCursor
      : null;
  } while (after);

  return media;
}

async function detachExactPlantMedia(
  admin: GraphqlClient,
  productId: string,
  mediaIds: string[],
): Promise<void> {
  const result = await adminGraphql<{
    fileUpdate: { userErrors: Array<{ message: string }> };
  }>(admin, DETACH_PRODUCT_MEDIA_MUTATION, {
    files: mediaIds.map((id) => ({ id, referencesToRemove: [productId] })),
  });
  if (result.fileUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.fileUpdate.userErrors,
        "Could not remove the photos the admin took off this EXACT PLANTS listing.",
      ),
    );
  }
}

/**
 * Applies the admin's approved title, price, weight and photos to an existing
 * product.
 *
 * The photos are the reason this exists: the review form lets the admin remove
 * and reorder them, and a retry that only sent the title left a photo the admin
 * had deliberately removed published on the store.
 */
async function updateExactPlantProduct(
  admin: GraphqlClient,
  product: ExactPlantProduct,
  input: {
    requestItemId: string;
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
    appUrl?: string;
  },
): Promise<{ id: string; handle: string }> {
  const plan = planExactPlantMedia({
    existing: await listExactPlantProductMedia(admin, product.id),
    title: input.title,
    photoUrls: input.photoUrls,
    appUrl: input.appUrl,
  });

  const updated = await adminGraphql<{
    productUpdate: {
      product: { id: string; handle: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation UpdateExactPlantProduct(
        $product: ProductUpdateInput!
        $media: [CreateMediaInput!]
      ) {
        productUpdate(product: $product, media: $media) {
          product { id handle }
          userErrors { message }
        }
      }
    `,
    {
      product: { id: product.id, title: input.title },
      // Left off rather than sent empty, so Shopify sees no media argument at
      // all when the product already carries the approved photos.
      media: plan.create.length > 0 ? plan.create : undefined,
    },
  );

  if (updated.productUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        updated.productUpdate.userErrors,
        "Could not update the existing EXACT PLANTS product.",
      ),
    );
  }

  if (plan.detachMediaIds.length > 0) {
    await detachExactPlantMedia(admin, product.id, plan.detachMediaIds);
  }

  await priceAndStockExactPlantVariant(admin, product, input);

  return updated.productUpdate.product ?? product;
}

/**
 * Prices the variant and puts one of it in stock.
 *
 * Both must happen before the product is published: publishing an untracked
 * plant lets several customers buy the same one, and publishing a tracked
 * plant that has not been stocked yet shows it as sold out.
 */
async function priceAndStockExactPlantVariant(
  admin: GraphqlClient,
  product: ExactPlantProduct,
  input: { price: number; weightLbs: number; requestItemId: string },
): Promise<void> {
  if (!product.variantId) return;
  await setExactPlantVariantPriceAndWeight(
    admin,
    product.id,
    product.variantId,
    input.price,
    input.weightLbs,
  );
  if (product.inventoryItemId) {
    await stockOneExactPlant(admin, product.inventoryItemId, input.requestItemId);
  }
}

export async function createExactPlantShopifyProduct(
  admin: GraphqlClient,
  input: {
    requestItemId: string;
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
    appUrl?: string;
  },
  /**
   * Called the moment a product for this plant exists in Shopify, before
   * anything that could still fail. Everything after this point leaves a
   * product behind whether it succeeds or not, so the caller needs the chance
   * to record it.
   */
  onProductIdentified?: (product: {
    productGid: string;
    handle: string;
  }) => Promise<void>,
): Promise<{ productGid: string; handle: string; collectionGid: string }> {
  const mediaError = exactPlantMediaError(input.photoUrls, input.appUrl);
  if (mediaError) throw new Error(mediaError);

  const existing = await findExactPlantProductByItemTag(admin, input.requestItemId);
  if (existing) {
    await onProductIdentified?.({
      productGid: existing.id,
      handle: existing.handle,
    });

    // A retry after an edit on the review form must land the edited values on
    // the one product for this item rather than create a second one.
    const collection = await findOrCreateExactPlantsCollection(admin);
    const refreshed = await updateExactPlantProduct(admin, existing, input);
    await addProductToCollection(admin, collection.id, refreshed.id);
    await publishProductToOnlineStoreAndPos(admin, refreshed.id);
    return {
      productGid: refreshed.id,
      handle: refreshed.handle,
      collectionGid: collection.id,
    };
  }

  const collection = await findOrCreateExactPlantsCollection(admin);
  const created = await adminGraphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        variants: {
          nodes: Array<{ id: string; inventoryItem: { id: string } }>;
        };
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation CreateExactPlantProduct(
        $product: ProductCreateInput!
        $media: [CreateMediaInput!]
      ) {
        productCreate(product: $product, media: $media) {
          product {
            id
            handle
            variants(first: 1) {
              nodes {
                id
                inventoryItem { id }
              }
            }
          }
          userErrors { message }
        }
      }
    `,
    buildExactPlantProductCreateInput({
      requestItemId: input.requestItemId,
      title: input.title,
      photoUrls: input.photoUrls,
      collectionId: collection.id,
      appUrl: input.appUrl,
    }),
  );

  const product = created.productCreate.product;
  if (!product) {
    throw new Error(
      userErrorMessage(
        created.productCreate.userErrors,
        "Shopify productCreate returned no product.",
      ),
    );
  }

  await onProductIdentified?.({ productGid: product.id, handle: product.handle });

  const variant = product.variants.nodes[0];
  await priceAndStockExactPlantVariant(
    admin,
    {
      id: product.id,
      handle: product.handle,
      variantId: variant?.id,
      inventoryItemId: variant?.inventoryItem.id,
    },
    input,
  );

  await addProductToCollection(admin, collection.id, product.id);
  await publishProductToOnlineStoreAndPos(admin, product.id);

  return {
    productGid: product.id,
    handle: product.handle,
    collectionGid: collection.id,
  };
}

