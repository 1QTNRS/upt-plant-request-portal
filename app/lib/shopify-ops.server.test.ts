import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createExactPlantShopifyProduct,
  resolveOnlineStoreAndPosPublications,
} from "./shopify-ops.server";

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
    inventoryItem: { inventoryLevel: { id: "gid://shopify/InventoryLevel/1" } },
  },
  StockExactPlant: { inventorySetQuantities: { userErrors: [] } },
  ActivateExactPlantInventory: { inventoryActivate: { userErrors: [] } },
  AddExactPlantToCollection: { collectionAddProducts: { userErrors: [] } },
  PublishExactPlant: { publishablePublish: { userErrors: [] } },
  // Shopify auto-publishes new products to any channel set to do so, so the
  // product comes back on a third channel the app never asked for.
  ExactPlantPublications: {
    product: {
      resourcePublicationsV2: {
        nodes: [
          { publication: { id: ONLINE_STORE_PUBLICATION } },
          { publication: { id: POS_PUBLICATION } },
          { publication: { id: "gid://shopify/Publication/3" } },
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
    assert.deepEqual(callOf(calls, "StockExactPlant").variables.input, {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId: INVENTORY_ITEM_GID,
          locationId: LOCATION_GID,
          quantity: 1,
        },
      ],
    });
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
    assert.deepEqual(callOf(calls, "ActivateExactPlantInventory").variables, {
      inventoryItemId: INVENTORY_ITEM_GID,
      locationId: LOCATION_GID,
    });
    assert.equal(
      calls.some((call) => call.operation === "StockExactPlant"),
      false,
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
          resourcePublicationsV2: {
            nodes: [
              { publication: { id: ONLINE_STORE_PUBLICATION } },
              { publication: { id: POS_PUBLICATION } },
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
