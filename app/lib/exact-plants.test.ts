import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExactPlantListingDraft,
  buildExactPlantProductCreateInput,
  declinedExactPlantIneligibilityReason,
  declinedItemTag,
  EXACT_PLANTS_COLLECTION_TITLE,
  isDeclinedExactPlant,
  isOnlineStorePublicationTitle,
  isPosPublicationTitle,
} from "./exact-plants";

describe("declined exact plant definition", () => {
  it("requires an available offered plant that the customer rejected", () => {
    assert.equal(
      isDeclinedExactPlant({
        offerAvailability: "available",
        responseChoice: "reject",
      }),
      true,
    );
  });

  it("excludes accepted, not available, never offered, and unavailable items", () => {
    assert.equal(
      isDeclinedExactPlant({
        offerAvailability: "available",
        responseChoice: "accept",
      }),
      false,
    );
    assert.equal(
      isDeclinedExactPlant({
        offerAvailability: "not_available",
        responseChoice: "reject",
      }),
      false,
    );
    assert.equal(
      isDeclinedExactPlant({
        offerAvailability: "not_available",
        responseChoice: "unavailable",
      }),
      false,
    );
    assert.match(
      declinedExactPlantIneligibilityReason({
        hasOfferItem: false,
        responseChoice: "reject",
      }) ?? "",
      /never offered/i,
    );
    assert.match(
      declinedExactPlantIneligibilityReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "accept",
      }) ?? "",
      /Accepted/,
    );
  });
});

describe("exact plant listing draft", () => {
  it("prefills title, price, weight, and photos and excludes customer/request fields", () => {
    const draft = buildExactPlantListingDraft({
      plantName: "Thai Constellation",
      offeredName: "Thai Constellation Exact",
      price: 175.4,
      weightLbs: 9.54,
      photoUrls: [
        "https://cdn.example/one.jpg",
        "https://cdn.example/two.jpg",
        "",
      ],
      customerFacingNotes: "Do not publish this disclaimer.",
      customerName: "Alex Rivera",
      customerEmail: "alex.rivera@example.com",
      requestNumber: "UPT-REQ-2026-000008",
      responseChoice: "reject",
    });

    assert.deepEqual(Object.keys(draft).sort(), [
      "photoUrls",
      "price",
      "title",
      "weightLbs",
    ]);
    assert.equal(draft.title, "Thai Constellation Exact");
    assert.equal(draft.price, 175.4);
    assert.equal(draft.weightLbs, 9.5);
    assert.deepEqual(draft.photoUrls, [
      "https://cdn.example/one.jpg",
      "https://cdn.example/two.jpg",
    ]);
    assert.equal("customerFacingNotes" in draft, false);
    assert.equal(JSON.stringify(draft).includes("disclaimer"), false);
    assert.equal(JSON.stringify(draft).includes("Alex Rivera"), false);
    assert.equal(JSON.stringify(draft).includes("UPT-REQ"), false);
  });
});

describe("shopify product payload", () => {
  it("adds the product to EXACT PLANTS and omits notes from the listing", () => {
    const payload = buildExactPlantProductCreateInput({
      requestItemId: "item_123",
      title: "Thai Constellation Exact",
      photoUrls: ["https://cdn.example/one.jpg", "data:image/png;base64,abc"],
      collectionId: "gid://shopify/Collection/1",
    });

    assert.equal(payload.product.title, "Thai Constellation Exact");
    assert.deepEqual(payload.product.collectionsToJoin, [
      "gid://shopify/Collection/1",
    ]);
    assert.ok(payload.product.tags.includes(EXACT_PLANTS_COLLECTION_TITLE));
    assert.ok(payload.product.tags.includes(declinedItemTag("item_123")));
    assert.equal("descriptionHtml" in payload.product, false);
    assert.equal(JSON.stringify(payload).includes("disclaimer"), false);
    assert.deepEqual(payload.media, [
      {
        originalSource: "https://cdn.example/one.jpg",
        alt: "Thai Constellation Exact",
        mediaContentType: "IMAGE",
      },
    ]);
  });

  it("matches Online Store and POS publications only", () => {
    assert.equal(isOnlineStorePublicationTitle("Online Store"), true);
    assert.equal(isPosPublicationTitle("Point of Sale"), true);
    assert.equal(isPosPublicationTitle("POS"), true);
    assert.equal(isOnlineStorePublicationTitle("Shop"), false);
    assert.equal(isPosPublicationTitle("Google & YouTube"), false);
  });
});
