import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  createExactPlantShopifyProduct,
  resolveFedexVariant,
  resolveOnlineStoreAndPosPublications,
  searchExistingStock,
} from "./shopify-ops.server";
import { unlinkableVariantReason } from "./growers-choice";
import { exactPlantInventoryIdempotencyKey } from "./inventory-concurrency";
import { FEDEX_PRODUCT_SKU, fedexVariantSkuQuery } from "./portal";
import { getShopSettings } from "./portal.server";
import { DEMO_SHOP } from "./shop";

type Call = { operation: string; query: string; variables: Record<string, unknown> };

type Responses = Record<string, unknown>;

/**
 * Stands in for the Admin API client. Every Shopify call the listing path makes
 * is recorded so the order it makes them in — and the payloads it sends — can be
 * asserted without a store, which is the only place these would otherwise fail.
 */
function fakeAdmin(responses: Responses, calls: Call[]) {
  return {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      const operation = query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
      calls.push({ operation, query, variables: options?.variables ?? {} });
      const data = responses[operation];
      if (Array.isArray(data)) {
        const next = data.shift();
        assert.ok(next !== undefined, `no remaining Shopify responses for ${operation}`);
        return { json: async () => ({ data: next }) };
      }
      assert.ok(data !== undefined, `unexpected Shopify operation ${operation}`);
      return { json: async () => ({ data }) };
    },
  } as unknown as Parameters<typeof createExactPlantShopifyProduct>[0];
}

const PRODUCT_GID = "gid://shopify/Product/1";
const VARIANT_GID = "gid://shopify/ProductVariant/1";
const INVENTORY_ITEM_GID = "gid://shopify/InventoryItem/1";
const LOCATION_GID = "gid://shopify/Location/1";
const ONLINE_STORE_PUBLICATION = "gid://shopify/Publication/1";
const POS_PUBLICATION = "gid://shopify/Publication/2";

function appCatalog(handle: string) {
  return { apps: { nodes: [{ handle }] } };
}

function publications(
  nodes: Array<{ id: string; catalog: unknown }>,
): Responses {
  return {
    SalesChannelPublications: {
      publications: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
    },
  };
}

const LISTING_RESPONSES: Responses = {
  ExactPlantProductByTag: { products: { nodes: [] } },
  ExactPlantsCollection: {
    collections: {
      nodes: [
        {
          id: "gid://shopify/Collection/1",
          title: "EXACT PLANTS",
          handle: "exact-plants",
        },
      ],
    },
  },
  CreateExactPlantProduct: {
    productCreate: {
      product: {
        id: PRODUCT_GID,
        handle: "monstera-thai-constellation",
        variants: {
          nodes: [{ id: VARIANT_GID, inventoryItem: { id: INVENTORY_ITEM_GID } }],
        },
      },
      userErrors: [],
    },
  },
  UpdateExactPlantVariant: { productVariantsBulkUpdate: { userErrors: [] } },
  ExactPlantInventoryLocation: { location: { id: LOCATION_GID } },
  ExactPlantInventoryLevel: {
    inventoryItem: {
      inventoryLevel: {
        id: "gid://shopify/InventoryLevel/1",
        quantities: [{ name: "available", quantity: 0 }],
      },
    },
  },
  StockExactPlant: { inventorySetQuantities: { userErrors: [] } },
  ActivateExactPlantInventory: { inventoryActivate: { userErrors: [] } },
  AddExactPlantToCollection: { collectionAddProducts: { userErrors: [] } },
  PublishExactPlant: { publishablePublish: { userErrors: [] } },
  // Shopify auto-publishes new products to any channel set to do so, so the
  // product comes back on a third channel the app never asked for.
  ExactPlantPublications: {
    product: {
      resourcePublications: {
        nodes: [
          { publication: { id: ONLINE_STORE_PUBLICATION, catalog: { title: "Online Store" } } },
          { publication: { id: POS_PUBLICATION, catalog: { title: "Point of Sale" } } },
          {
            publication: {
              id: "gid://shopify/Publication/3",
              catalog: { title: "Microsoft Copilot" },
            },
          },
        ],
      },
    },
  },
  UnpublishExactPlant: { publishableUnpublish: { userErrors: [] } },
  ...publications([
    { id: ONLINE_STORE_PUBLICATION, catalog: appCatalog("online_store") },
    { id: POS_PUBLICATION, catalog: appCatalog("pos") },
    { id: "gid://shopify/Publication/3", catalog: appCatalog("shop") },
  ]),
};

async function listOnePlant(
  overrides: Responses = {},
  input: { photoUrls?: string[] } = {},
): Promise<Call[]> {
  const calls: Call[] = [];
  await createExactPlantShopifyProduct(
    fakeAdmin({ ...LISTING_RESPONSES, ...overrides }, calls),
    {
      requestItemId: "item_1",
      title: "Monstera Thai Constellation",
      price: 285,
      weightLbs: 4.5,
      photoUrls: input.photoUrls ?? ["https://cdn.shopify.com/s/files/1/photo.jpg"],
    },
  );
  return calls;
}

const EXISTING_PHOTO = "https://cdn.shopify.com/s/files/1/kept.jpg";
const REMOVED_PHOTO = "https://cdn.shopify.com/s/files/1/removed.jpg";

/** Responses for a retry against the product an earlier approval created. */
function retryResponses(
  media: Array<{ id: string; originalSource?: { url: string } | null }>,
): Responses {
  return {
    ExactPlantProductByTag: {
      products: {
        nodes: [
          {
            id: PRODUCT_GID,
            handle: "monstera-thai-constellation",
            variants: {
              nodes: [
                { id: VARIANT_GID, inventoryItem: { id: INVENTORY_ITEM_GID } },
              ],
            },
          },
        ],
      },
    },
    ExactPlantProductMedia: {
      product: {
        media: {
          nodes: media,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
    UpdateExactPlantProduct: {
      productUpdate: {
        product: { id: PRODUCT_GID, handle: "monstera-thai-constellation" },
        userErrors: [],
      },
    },
    DetachExactPlantMedia: { fileUpdate: { userErrors: [] } },
  };
}

function callOf(calls: Call[], operation: string): Call {
  const call = calls.find((entry) => entry.operation === operation);
  assert.ok(call, `${operation} was never called`);
  return call;
}

describe("EXACT PLANTS listing on Shopify", () => {
  it("looks the existing product up by a quoted tag", async () => {
    const calls = await listOnePlant();
    assert.equal(
      callOf(calls, "ExactPlantProductByTag").variables.query,
      "tag:'upt-declined-item:item_1'",
    );
  });

  it("tracks one unit of stock and refuses oversell", async () => {
    const calls = await listOnePlant();
    assert.deepEqual(callOf(calls, "UpdateExactPlantVariant").variables.variants, [
      {
        id: VARIANT_GID,
        price: "285.00",
        inventoryPolicy: "DENY",
        inventoryItem: {
          tracked: true,
          measurement: { weight: { value: 4.5, unit: "POUNDS" } },
        },
      },
    ]);
    const stock = callOf(calls, "StockExactPlant");
    assert.deepEqual(stock.variables.input, {
      name: "available",
      reason: "correction",
      quantities: [
        {
          inventoryItemId: INVENTORY_ITEM_GID,
          locationId: LOCATION_GID,
          quantity: 1,
          changeFromQuantity: 0,
        },
      ],
    });
    assert.equal(
      stock.variables.idempotencyKey,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "set",
        changeFromQuantity: 0,
      }),
    );
    assert.match(stock.query, /@idempotent\(key: \$idempotencyKey\)/);
    assert.equal(
      JSON.stringify(callOf(calls, "UpdateExactPlantVariant").variables.variants).includes(
        "quantityAdjustments",
      ),
      false,
    );
  });

  it("stocks the plant before publishing it", async () => {
    // Publishing an untracked plant lets several customers buy the same one;
    // publishing a tracked plant that has not been stocked shows it sold out.
    const operations = (await listOnePlant()).map((call) => call.operation);
    assert.ok(
      operations.indexOf("UpdateExactPlantVariant") <
        operations.indexOf("PublishExactPlant"),
    );
    assert.ok(
      operations.indexOf("StockExactPlant") < operations.indexOf("PublishExactPlant"),
    );
  });

  it("activates inventory at the primary location when it is not stocked there", async () => {
    const calls = await listOnePlant({
      ExactPlantInventoryLevel: { inventoryItem: { inventoryLevel: null } },
    });
    const activate = callOf(calls, "ActivateExactPlantInventory");
    assert.deepEqual(activate.variables, {
      inventoryItemId: INVENTORY_ITEM_GID,
      locationId: LOCATION_GID,
      available: 1,
      idempotencyKey: exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "activate",
      }),
    });
    assert.match(activate.query, /@idempotent\(key: \$idempotencyKey\)/);
    assert.equal(
      calls.some((call) => call.operation === "StockExactPlant"),
      false,
    );
  });

  it("retries a concurrent inventory set with the same idempotency key", async () => {
    const calls = await listOnePlant({
      StockExactPlant: [
        {
          inventorySetQuantities: {
            userErrors: [
              {
                code: "IDEMPOTENCY_CONCURRENT_REQUEST",
                message: "This request is currently in progress, please try again.",
              },
            ],
          },
        },
        { inventorySetQuantities: { userErrors: [] } },
      ],
    });
    const stockCalls = calls.filter((call) => call.operation === "StockExactPlant");
    assert.equal(stockCalls.length, 2);
    assert.deepEqual(stockCalls[0].variables, stockCalls[1].variables);
    assert.equal(
      stockCalls[0].variables.idempotencyKey,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "set",
        changeFromQuantity: 0,
      }),
    );
  });

  it("re-reads available quantity after a stale compare-and-set", async () => {
    const calls = await listOnePlant({
      ExactPlantInventoryLevel: [
        {
          inventoryItem: {
            inventoryLevel: {
              id: "gid://shopify/InventoryLevel/1",
              quantities: [{ name: "available", quantity: 0 }],
            },
          },
        },
        {
          inventoryItem: {
            inventoryLevel: {
              id: "gid://shopify/InventoryLevel/1",
              quantities: [{ name: "available", quantity: 1 }],
            },
          },
        },
      ],
      StockExactPlant: [
        {
          inventorySetQuantities: {
            userErrors: [
              {
                code: "CHANGE_FROM_QUANTITY_STALE",
                message: "The compare quantity no longer matches.",
              },
            ],
          },
        },
        { inventorySetQuantities: { userErrors: [] } },
      ],
    });
    const stockCalls = calls.filter((call) => call.operation === "StockExactPlant");
    assert.equal(stockCalls.length, 2);
    assert.equal(
      (stockCalls[0].variables.input as { quantities: Array<{ changeFromQuantity: number }> })
        .quantities[0].changeFromQuantity,
      0,
    );
    assert.equal(
      (stockCalls[1].variables.input as { quantities: Array<{ changeFromQuantity: number }> })
        .quantities[0].changeFromQuantity,
      1,
    );
    assert.notEqual(
      stockCalls[0].variables.idempotencyKey,
      stockCalls[1].variables.idempotencyKey,
    );
    assert.equal(
      stockCalls[1].variables.idempotencyKey,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "set",
        changeFromQuantity: 1,
      }),
    );
  });

  it("retries activate with the same key, then sets if another retry activated first", async () => {
    const calls = await listOnePlant({
      ExactPlantInventoryLevel: [
        { inventoryItem: { inventoryLevel: null } },
        {
          inventoryItem: {
            inventoryLevel: {
              id: "gid://shopify/InventoryLevel/1",
              quantities: [{ name: "available", quantity: 0 }],
            },
          },
        },
      ],
      ActivateExactPlantInventory: {
        inventoryActivate: {
          userErrors: [{ code: "ALREADY_ACTIVATED", message: "Already stocked at this location." }],
        },
      },
    });
    const activate = callOf(calls, "ActivateExactPlantInventory");
    assert.equal(
      activate.variables.idempotencyKey,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "activate",
      }),
    );
    const stock = callOf(calls, "StockExactPlant");
    assert.equal(
      (stock.variables.input as { quantities: Array<{ changeFromQuantity: number }> })
        .quantities[0].changeFromQuantity,
      0,
    );
  });

  it("publishes to Online Store and POS and to nothing else", async () => {
    const calls = await listOnePlant();
    assert.deepEqual(callOf(calls, "PublishExactPlant").variables.input, [
      { publicationId: ONLINE_STORE_PUBLICATION },
      { publicationId: POS_PUBLICATION },
    ]);
  });

  it("takes the listing off a channel Shopify published it to by itself", async () => {
    const calls = await listOnePlant();

    // Publishing to two channels does not keep a product off the others: a
    // channel set to auto-publish picks it up at creation. On the dev store
    // Shopify recorded "Product was included on Microsoft Copilot" a second
    // after productCreate, attributed to no app.
    assert.deepEqual(callOf(calls, "UnpublishExactPlant").variables.input, [
      { publicationId: "gid://shopify/Publication/3" },
    ]);
  });

  it("does not unpublish when the listing is only on the two intended channels", async () => {
    const calls = await listOnePlant({
      ExactPlantPublications: {
        product: {
          resourcePublications: {
            nodes: [
              { publication: { id: ONLINE_STORE_PUBLICATION, catalog: { title: "Online Store" } } },
              { publication: { id: POS_PUBLICATION, catalog: { title: "Point of Sale" } } },
            ],
          },
        },
      },
    });

    assert.equal(
      calls.some((call) => call.operation === "UnpublishExactPlant"),
      false,
    );
  });

  it("asks Shopify for app catalogs, which is the only way catalog is not null", async () => {
    const calls = await listOnePlant();
    const query = callOf(calls, "SalesChannelPublications").query;
    assert.match(query, /publications\(first: 50, after: \$after, catalogType: APP\)/);
    assert.match(query, /\.\.\. on AppCatalog/);
    assert.match(query, /nodes \{ handle \}/);
  });
});

describe("retrying an EXACT PLANTS listing after the admin edited the photos", () => {
  it("adds the approved photos and takes the removed one off the product", async () => {
    const calls = await listOnePlant(
      retryResponses([
        { id: "gid://shopify/MediaImage/1", originalSource: { url: EXISTING_PHOTO } },
        { id: "gid://shopify/MediaImage/2", originalSource: { url: REMOVED_PHOTO } },
      ]),
      { photoUrls: [EXISTING_PHOTO] },
    );

    assert.deepEqual(callOf(calls, "UpdateExactPlantProduct").variables, {
      product: { id: PRODUCT_GID, title: "Monstera Thai Constellation" },
      media: [
        {
          originalSource: EXISTING_PHOTO,
          alt: "Monstera Thai Constellation",
          mediaContentType: "IMAGE",
        },
      ],
    });
    assert.deepEqual(callOf(calls, "DetachExactPlantMedia").variables.files, [
      {
        id: "gid://shopify/MediaImage/1",
        referencesToRemove: [PRODUCT_GID],
      },
      {
        id: "gid://shopify/MediaImage/2",
        referencesToRemove: [PRODUCT_GID],
      },
    ]);
  });

  it("adds the approved photos before removing the old ones", async () => {
    // The other order leaves the product with no image at all in between.
    const operations = (
      await listOnePlant(
        retryResponses([
          { id: "gid://shopify/MediaImage/2", originalSource: { url: REMOVED_PHOTO } },
        ]),
        { photoUrls: [EXISTING_PHOTO] },
      )
    ).map((call) => call.operation);
    assert.ok(
      operations.indexOf("UpdateExactPlantProduct") <
        operations.indexOf("DetachExactPlantMedia"),
    );
  });

  it("leaves the media alone when it already matches the approved photos", async () => {
    const calls = await listOnePlant(
      retryResponses([
        {
          id: "gid://shopify/MediaImage/1",
          originalSource: { url: `${EXISTING_PHOTO}?v=1712` },
        },
      ]),
      { photoUrls: [EXISTING_PHOTO] },
    );

    assert.equal(callOf(calls, "UpdateExactPlantProduct").variables.media, undefined);
    assert.equal(
      calls.some((call) => call.operation === "DetachExactPlantMedia"),
      false,
    );
  });

  it("still stocks the plant before publishing it on a retry", async () => {
    const operations = (
      await listOnePlant(
        retryResponses([
          { id: "gid://shopify/MediaImage/1", originalSource: { url: EXISTING_PHOTO } },
        ]),
        { photoUrls: [EXISTING_PHOTO] },
      )
    ).map((call) => call.operation);
    assert.ok(
      operations.indexOf("StockExactPlant") < operations.indexOf("PublishExactPlant"),
    );
    assert.equal(
      operations.filter((operation) => operation === "CreateExactPlantProduct").length,
      0,
      "a retry updates the one product for this plant instead of creating another",
    );
  });
});

/** One `ProductVariant` as the stock search reads it back. */
function variantNode(overrides: {
  id: string;
  title?: string;
  sku?: string | null;
  price?: string;
  availableForSale?: boolean;
  inventoryQuantity?: number | null;
  tracked?: boolean;
  weight?: { value: number; unit: string } | null;
  variantImage?: string | null;
  productImage?: string | null;
  productStatus?: string;
  productTitle?: string;
  publishedOnPublication?: boolean;
}) {
  return {
    id: overrides.id,
    title: overrides.title ?? "6 inch",
    sku: overrides.sku ?? "MTC-6",
    price: overrides.price ?? "285.00",
    availableForSale: overrides.availableForSale ?? true,
    inventoryQuantity: overrides.inventoryQuantity ?? 3,
    inventoryItem: {
      tracked: overrides.tracked ?? true,
      measurement: {
        weight: overrides.weight === undefined
          ? { value: 4.5, unit: "POUNDS" }
          : overrides.weight,
      },
    },
    media: {
      nodes: overrides.variantImage
        ? [{ preview: { image: { url: overrides.variantImage } } }]
        : [],
    },
    product: {
      id: "gid://shopify/Product/9001",
      title: overrides.productTitle ?? "Monstera Thai Constellation",
      handle: "monstera-thai-constellation",
      status: overrides.productStatus ?? "ACTIVE",
      publishedOnPublication: overrides.publishedOnPublication ?? true,
      featuredMedia: overrides.productImage
        ? { preview: { image: { url: overrides.productImage } } }
        : null,
    },
  };
}

function stockSearch(
  productVariantNodes: ReturnType<typeof variantNode>[],
  looseVariantNodes: ReturnType<typeof variantNode>[] = [],
): Responses {
  return {
    ...publications([
      { id: ONLINE_STORE_PUBLICATION, catalog: appCatalog("online_store") },
      { id: POS_PUBLICATION, catalog: appCatalog("pos") },
    ]),
    PortalStockSearch: {
      products: { nodes: [{ variants: { nodes: productVariantNodes } }] },
      productVariants: { nodes: looseVariantNodes },
    },
  };
}

describe("searching the shop's existing stock", () => {
  const merchantShop = "stock-search.myshopify.com";

  async function search(responses: Responses, term = "monstera thai") {
    const calls: Call[] = [];
    const found = await searchExistingStock(
      fakeAdmin(responses, calls),
      merchantShop,
      term,
    );
    return { found, calls };
  }

  it("asks both roots in one round trip, wildcarding each word", async () => {
    // `products` reaches the product's own text and its variants' SKUs;
    // `productVariants` reaches a variant title like "6 inch", which is where
    // the size lives on a plant listing. `status:active` is Shopify's product
    // status filter; Online Store publication is checked separately.
    const { calls } = await search(stockSearch([variantNode({ id: "gid://shopify/ProductVariant/1" })]));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].operation, "SalesChannelPublications");
    assert.equal(calls[1].operation, "PortalStockSearch");
    assert.equal(calls[1].variables.query, "monstera* thai* status:active");
    assert.equal(calls[1].variables.onlineStorePublicationId, ONLINE_STORE_PUBLICATION);
  });

  it("merges the two roots on variant id rather than listing a variant twice", async () => {
    const { found } = await search(
      stockSearch(
        [variantNode({ id: "gid://shopify/ProductVariant/1" })],
        [
          variantNode({ id: "gid://shopify/ProductVariant/1" }),
          variantNode({ id: "gid://shopify/ProductVariant/2", title: "8 inch" }),
        ],
      ),
    );
    assert.deepEqual(
      found.map((candidate) => candidate.variantGid),
      ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
    );
  });

  it("asks Shopify nothing for a term too short to mean anything", async () => {
    const { found, calls } = await search(stockSearch([]), "m");
    assert.deepEqual(found, []);
    assert.equal(calls.length, 0);
  });

  it("prefers the variant's own photo, which is the size being offered", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({
          id: "gid://shopify/ProductVariant/1",
          variantImage: "https://cdn.shopify.com/variant.jpg",
          productImage: "https://cdn.shopify.com/product.jpg",
        }),
        variantNode({
          id: "gid://shopify/ProductVariant/2",
          productImage: "https://cdn.shopify.com/product.jpg",
        }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => candidate.imageUrl),
      ["https://cdn.shopify.com/variant.jpg", "https://cdn.shopify.com/product.jpg"],
    );
  });

  it("converts the weight to pounds, whatever unit the merchant chose", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({
          id: "gid://shopify/ProductVariant/1",
          weight: { value: 2, unit: "KILOGRAMS" },
        }),
        variantNode({ id: "gid://shopify/ProductVariant/2", weight: null }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => candidate.weightLbs),
      [4.4, null],
    );
  });

  it("distinguishes stock Shopify does not count from stock it counts as none", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({
          id: "gid://shopify/ProductVariant/1",
          tracked: false,
          inventoryQuantity: null,
        }),
        variantNode({ id: "gid://shopify/ProductVariant/2", inventoryQuantity: 0 }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => candidate.inventoryQuantity),
      [null, 0],
    );
    assert.deepEqual(
      found.map((candidate) => unlinkableVariantReason(candidate)),
      [null, "This variant is out of stock."],
    );
  });

  it("keeps zero-price and not-for-sale ACTIVE Online Store rows visible", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({ id: "gid://shopify/ProductVariant/2", price: "0.00" }),
        variantNode({
          id: "gid://shopify/ProductVariant/3",
          availableForSale: false,
        }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => unlinkableVariantReason(candidate)),
      [
        "This variant has no price in Shopify.",
        "Shopify reports this variant as not available for sale.",
      ],
    );
  });

  it("drops draft, archived, and Online Store-unpublished products server-side", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({ id: "gid://shopify/ProductVariant/1", productStatus: "DRAFT" }),
        variantNode({ id: "gid://shopify/ProductVariant/2", productStatus: "ARCHIVED" }),
        variantNode({
          id: "gid://shopify/ProductVariant/3",
          publishedOnPublication: false,
        }),
        variantNode({
          id: "gid://shopify/ProductVariant/4",
          productTitle: "Visible Thai",
        }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => candidate.variantGid),
      ["gid://shopify/ProductVariant/4"],
    );
  });

  it("keeps an ACTIVE Online Store variant that is out of stock", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({
          id: "gid://shopify/ProductVariant/zero",
          inventoryQuantity: 0,
          availableForSale: false,
        }),
      ]),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].inventoryQuantity, 0);
    assert.equal(unlinkableVariantReason(found[0]), "This variant is out of stock.");
  });

  it("reports inventory per variant, not a product total", async () => {
    const { found } = await search(
      stockSearch([
        variantNode({
          id: "gid://shopify/ProductVariant/small",
          title: "4 inch",
          inventoryQuantity: 1,
        }),
        variantNode({
          id: "gid://shopify/ProductVariant/large",
          title: "8 inch",
          inventoryQuantity: 0,
        }),
      ]),
    );
    assert.deepEqual(
      found.map((candidate) => [candidate.variantTitle, candidate.inventoryQuantity]),
      [
        ["4 inch", 1],
        ["8 inch", 0],
      ],
    );
  });
});

describe("FedEx upgrade listing", () => {
  const shop = `${DEMO_SHOP}-fedex-sku`;
  const skuVariantGid = "gid://shopify/ProductVariant/991236";
  const handleVariantGid = "gid://shopify/ProductVariant/778899";

  const reset = async () => {
    await prisma.shopSettings.deleteMany({ where: { shop } });
  };

  before(reset);
  after(reset);

  it("looks up the live UPT SKU before the product handle", async () => {
    const calls: Call[] = [];
    const result = await resolveFedexVariant(
      fakeAdmin(
        {
          FedexUpgradeVariantBySku: {
            productVariants: {
              nodes: [
                { id: skuVariantGid, sku: FEDEX_PRODUCT_SKU, price: "15.00" },
              ],
            },
          },
        },
        calls,
      ),
      shop,
    );

    assert.equal(result.variantGid, skuVariantGid);
    assert.equal(result.price, 15);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["FedexUpgradeVariantBySku"],
    );
    assert.deepEqual(calls[0]?.variables, {
      query: fedexVariantSkuQuery(FEDEX_PRODUCT_SKU),
    });
    assert.equal(fedexVariantSkuQuery(), `sku:${FEDEX_PRODUCT_SKU}`);

    const settings = await getShopSettings(shop);
    assert.equal(settings.fedexVariantGid, skuVariantGid);
    assert.equal(settings.fedexUpgradePrice, 15);
  });

  it("falls back to the product handle when the SKU is missing", async () => {
    const calls: Call[] = [];
    const result = await resolveFedexVariant(
      fakeAdmin(
        {
          FedexUpgradeVariantBySku: { productVariants: { nodes: [] } },
          FedexUpgradeProduct: {
            productByIdentifier: {
              variants: {
                nodes: [{ id: handleVariantGid, price: "18.00" }],
              },
            },
          },
        },
        calls,
      ),
      shop,
    );

    assert.equal(result.variantGid, handleVariantGid);
    assert.equal(result.price, 18);
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["FedexUpgradeVariantBySku", "FedexUpgradeProduct"],
    );
  });
});

describe("sales channel publications", () => {
  async function resolve(nodes: Array<{ id: string; catalog: unknown }>) {
    const calls: Call[] = [];
    return resolveOnlineStoreAndPosPublications(fakeAdmin(publications(nodes), calls));
  }

  it("matches the untranslated app handle, not the catalog title", async () => {
    // With `catalogType: APP` the title reads "Channel Catalog 123 for Online
    // Store" and is translated into the merchant's admin language.
    const resolved = await resolve([
      {
        id: ONLINE_STORE_PUBLICATION,
        catalog: { ...appCatalog("online_store"), title: "Boutique en ligne" },
      },
      {
        id: POS_PUBLICATION,
        catalog: { ...appCatalog("pos"), title: "Point de vente" },
      },
    ]);
    assert.deepEqual(resolved, {
      onlineStoreId: ONLINE_STORE_PUBLICATION,
      posId: POS_PUBLICATION,
    });
  });

  it("blames the missing sales channel rather than the app's scopes", async () => {
    const error = await resolve([
      { id: ONLINE_STORE_PUBLICATION, catalog: appCatalog("online_store") },
    ]).catch((thrown: Error) => thrown);

    assert.ok(error instanceof Error);
    assert.match(error.message, /POS \(pos or point_of_sale\)/);
    assert.match(error.message, /Apps and sales channels/);
    assert.equal(/scope/i.test(error.message), false);
  });
});
