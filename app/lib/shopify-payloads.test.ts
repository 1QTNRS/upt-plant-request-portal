import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExactPlantInventoryInput,
  buildExactPlantProductCreateInput,
  buildExactPlantVariantInput,
  declinedItemTag,
  exactPlantMediaError,
  hostedPhotoUrls,
} from "./exact-plants";
import { exactPlantInventoryIdempotencyKey } from "./inventory-concurrency";
import {
  buildDraftOrderInput,
  buildDraftOrderLineItems,
  draftOrderIdempotencyTag,
  DRAFT_ORDER_TAG,
  tagSearchQuery,
} from "./portal";

const ACCEPTED = [
  {
    itemId: "item_1",
    plantName: "Monstera Thai Constellation",
    quantity: 1,
    price: 285,
    weightLbs: 4.5,
  },
];

function lineItems(fedexSelected: boolean, fedexVariantGid?: string) {
  return buildDraftOrderLineItems({
    acceptedItems: ACCEPTED,
    fedexSelected,
    fedexLabel: "FedEx Priority Overnight Upgrade",
    fedexPrice: 15,
    fedexVariantGid,
  });
}

describe("draft order input", () => {
  it("prices custom plant lines with an explicit currency", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(false),
    });

    assert.deepEqual(input.lineItems, [
      {
        title: "Monstera Thai Constellation",
        originalUnitPriceWithCurrency: { amount: "285.00", currencyCode: "USD" },
        quantity: 1,
        weight: { value: 4.5, unit: "POUNDS" },
        // Without this Shopify collects no delivery address for a live plant.
        requiresShipping: true,
      },
    ]);
  });

  it("does not send the removed originalUnitPrice field", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ1",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(true),
    });
    for (const line of input.lineItems) {
      assert.equal("originalUnitPrice" in line, false);
    }
  });

  it("tags the draft order so the orders/paid webhook can match it", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(false),
    });
    // The request number is what `orders/paid` matches on; the per-request tag
    // is what stops a retry creating a second draft order.
    assert.deepEqual(input.tags, [
      DRAFT_ORDER_TAG,
      "REQ2178",
      draftOrderIdempotencyTag("req_1"),
    ]);
    assert.equal(input.note, "UPT plant request REQ2178");
  });

  it("carries a per-request tag so a retry finds the existing draft order", () => {
    const first = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ1",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(false),
    });
    const second = buildDraftOrderInput({
      requestId: "req_2",
      requestNumber: "REQ2",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(false),
    });
    assert.notEqual(
      first.tags.at(-1),
      second.tags.at(-1),
      "two requests must not share an idempotency tag",
    );
  });

  it("uses the real FedEx variant when one was resolved", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(true, "gid://shopify/ProductVariant/42"),
    });
    assert.deepEqual(input.lineItems.at(-1), {
      variantId: "gid://shopify/ProductVariant/42",
      quantity: 1,
      originalUnitPriceWithCurrency: { amount: "15.00", currencyCode: "USD" },
    });
  });

  it("bills the FedEx upgrade at the price the customer was quoted", () => {
    // The variant price can move between the offer being sent and the invoice
    // being opened; the customer must be charged the amount they answered.
    const quoted = buildDraftOrderLineItems({
      acceptedItems: ACCEPTED,
      fedexSelected: true,
      fedexLabel: "FedEx Priority Overnight Upgrade",
      fedexPrice: 24.5,
      fedexVariantGid: "gid://shopify/ProductVariant/42",
    });
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: quoted,
    });
    assert.deepEqual(
      input.lineItems.at(-1)?.originalUnitPriceWithCurrency,
      { amount: "24.50", currencyCode: "USD" },
    );
  });

  it("falls back to a custom FedEx line when no variant was resolved", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "CAD",
      lineItems: lineItems(true),
    });
    assert.deepEqual(input.lineItems.at(-1), {
      title: "FedEx Priority Overnight Upgrade",
      originalUnitPriceWithCurrency: { amount: "15.00", currencyCode: "CAD" },
      quantity: 1,
      weight: { value: 0, unit: "POUNDS" },
      // The upgrade is the shipping, so it is not itself shipped.
      requiresShipping: false,
    });
  });
});

describe("Shopify tag lookups", () => {
  it("quotes the tag so the colon in it is not read as a field separator", () => {
    // An unquoted `tag:upt-declined-item:abc` parses as the tag
    // `upt-declined-item` plus a loose term, so it matches another plant's
    // product and a retry then overwrites that product's title and price.
    assert.equal(
      tagSearchQuery(declinedItemTag("item_1")),
      "tag:'upt-declined-item:item_1'",
    );
    assert.equal(
      tagSearchQuery(draftOrderIdempotencyTag("req_1")),
      "tag:'upt-request:req_1'",
    );
  });
});

describe("EXACT PLANTS variant stocking", () => {
  it("tracks the variant and refuses oversell", () => {
    assert.deepEqual(
      buildExactPlantVariantInput({
        variantId: "gid://shopify/ProductVariant/1",
        price: 285,
        weightLbs: 4.5,
      }),
      {
        id: "gid://shopify/ProductVariant/1",
        price: "285.00",
        inventoryPolicy: "DENY",
        inventoryItem: {
          tracked: true,
          measurement: { weight: { value: 4.5, unit: "POUNDS" } },
        },
      },
    );
  });

  it("sets the stock of one physical plant to one against the expected quantity", () => {
    assert.deepEqual(
      buildExactPlantInventoryInput({
        inventoryItemId: "gid://shopify/InventoryItem/1",
        locationId: "gid://shopify/Location/1",
        changeFromQuantity: 0,
      }),
      {
        name: "available",
        reason: "correction",
        quantities: [
          {
            inventoryItemId: "gid://shopify/InventoryItem/1",
            locationId: "gid://shopify/Location/1",
            quantity: 1,
            changeFromQuantity: 0,
          },
        ],
      },
    );
  });

  it("does not opt out of compare-and-set by passing a null expected quantity", () => {
    const input = buildExactPlantInventoryInput({
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
      changeFromQuantity: 1,
    });
    assert.equal("ignoreCompareQuantity" in input, false);
    assert.equal(input.quantities[0].changeFromQuantity, 1);
  });
});

describe("EXACT PLANTS inventory idempotency keys", () => {
  it("reuses the same key for a retry of the same set", () => {
    const first = exactPlantInventoryIdempotencyKey({
      requestItemId: "item_1",
      operation: "set",
      changeFromQuantity: 0,
    });
    const retry = exactPlantInventoryIdempotencyKey({
      requestItemId: "item_1",
      operation: "set",
      changeFromQuantity: 0,
    });
    assert.equal(first, retry);
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("issues a new key when the expected quantity or item changes", () => {
    const original = exactPlantInventoryIdempotencyKey({
      requestItemId: "item_1",
      operation: "set",
      changeFromQuantity: 0,
    });
    assert.notEqual(
      original,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "set",
        changeFromQuantity: 1,
      }),
    );
    assert.notEqual(
      original,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_2",
        operation: "set",
        changeFromQuantity: 0,
      }),
    );
    assert.notEqual(
      original,
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "activate",
      }),
    );
  });
});

describe("EXACT PLANTS product media", () => {
  it("keeps Shopify CDN photos", () => {
    assert.deepEqual(
      hostedPhotoUrls(["https://cdn.shopify.com/s/files/1/photo.jpg"]),
      ["https://cdn.shopify.com/s/files/1/photo.jpg"],
    );
  });

  it("makes local upload paths absolute so Shopify can fetch them", () => {
    assert.deepEqual(
      hostedPhotoUrls(["/uploads/shop/item/photo.jpg"], "https://portal.example.com/"),
      ["https://portal.example.com/uploads/shop/item/photo.jpg"],
    );
  });

  it("drops data URLs, which Shopify cannot fetch", () => {
    assert.deepEqual(
      hostedPhotoUrls(["data:image/png;base64,AAAA"], "https://portal.example.com"),
      [],
    );
  });

  it("drops local paths when the app URL is not https", () => {
    assert.deepEqual(
      hostedPhotoUrls(["/uploads/shop/item/photo.jpg"], "http://localhost:3000"),
      [],
    );
  });

  it("reports an error rather than listing a plant with no photos", () => {
    const error = exactPlantMediaError(["data:image/png;base64,AAAA"]);
    assert.match(error ?? "", /Re-upload the photos/);
  });

  it("reports no error when at least one photo is usable", () => {
    assert.equal(
      exactPlantMediaError([
        "data:image/png;base64,AAAA",
        "https://cdn.shopify.com/s/files/1/photo.jpg",
      ]),
      null,
    );
  });

  it("reports no error when the admin approved no photos", () => {
    assert.equal(exactPlantMediaError([]), null);
  });

  it("publishes only the approved title, tags and collection", () => {
    const { product, media } = buildExactPlantProductCreateInput({
      requestItemId: "item_1",
      title: "Monstera Thai Constellation",
      photoUrls: ["https://cdn.shopify.com/s/files/1/photo.jpg"],
      collectionId: "gid://shopify/Collection/1",
    });

    assert.deepEqual(product, {
      title: "Monstera Thai Constellation",
      status: "ACTIVE",
      vendor: "UPT",
      productType: "Exact Plant",
      tags: ["EXACT PLANTS", "upt-declined-item:item_1"],
      collectionsToJoin: ["gid://shopify/Collection/1"],
    });
    assert.equal(media.length, 1);

    // Customer identity, request information and customer-facing notes must
    // never reach a public product.
    const serialized = JSON.stringify({ product, media });
    for (const leak of ["REQ", "@", "customer", "notes", "reject"]) {
      assert.equal(
        serialized.toLowerCase().includes(leak.toLowerCase()),
        false,
        `product payload leaked "${leak}"`,
      );
    }
  });
});
