import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExactPlantProductCreateInput,
  exactPlantMediaError,
  hostedPhotoUrls,
} from "./exact-plants";
import {
  buildDraftOrderInput,
  buildDraftOrderLineItems,
  DRAFT_ORDER_TAG,
} from "./portal";

const ACCEPTED = [
  { plantName: "Monstera Thai Constellation", quantity: 1, price: 285, weightLbs: 4.5 },
];

function lineItems(fedexSelected: boolean) {
  return buildDraftOrderLineItems({
    acceptedItems: ACCEPTED,
    fedexSelected,
    fedexLabel: "FedEx Priority Overnight Upgrade",
    fedexPrice: 15,
  });
}

describe("draft order input", () => {
  it("prices custom plant lines with an explicit currency", () => {
    const input = buildDraftOrderInput({
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
      },
    ]);
  });

  it("does not send the removed originalUnitPrice field", () => {
    const input = buildDraftOrderInput({
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
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(false),
    });
    assert.deepEqual(input.tags, [DRAFT_ORDER_TAG, "REQ2178"]);
    assert.equal(input.note, "UPT plant request REQ2178");
  });

  it("uses the real FedEx variant when one was resolved", () => {
    const input = buildDraftOrderInput({
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: lineItems(true),
      fedexVariantGid: "gid://shopify/ProductVariant/42",
    });
    assert.deepEqual(input.lineItems.at(-1), {
      variantId: "gid://shopify/ProductVariant/42",
      quantity: 1,
    });
  });

  it("falls back to a custom FedEx line when no variant was resolved", () => {
    const input = buildDraftOrderInput({
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
    });
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
