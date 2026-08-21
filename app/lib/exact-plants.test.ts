import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExactPlantListingDraft,
  buildExactPlantProductCreateInput,
  declinedItemTag,
  EXACT_PLANT_RELEASE_LABELS,
  EXACT_PLANTS_COLLECTION_TITLE,
  exactPlantIneligibilityReason,
  exactPlantReleaseReason,
  isExactPlantEligible,
  isOnlineStorePublicationTitle,
  isPosPublicationTitle,
} from "./exact-plants";

/** An available plant offered on a request that has not been paid. */
function offered(overrides: Record<string, unknown> = {}) {
  return {
    hasOfferItem: true,
    offerAvailability: "available",
    requestStatus: "Pending",
    ...overrides,
  };
}

describe("exact plant release eligibility", () => {
  it("releases a plant the customer declined", () => {
    assert.equal(
      exactPlantReleaseReason(offered({ responseChoice: "reject" })),
      "customer_declined",
    );
  });

  it("releases a plant the customer accepted but never paid for", () => {
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Expired" }),
      ),
      "accepted_unpaid_expired",
    );
  });

  it("releases a plant the customer never answered on an expired offer", () => {
    assert.equal(
      exactPlantReleaseReason(offered({ requestStatus: "Expired" })),
      "never_responded_expired",
    );
  });

  it("keeps holding a plant the customer accepted while the hold is live", () => {
    assert.equal(exactPlantReleaseReason(offered({ responseChoice: "accept" })), null);
  });

  it("keeps holding a plant nobody has answered while the hold is live", () => {
    assert.equal(exactPlantReleaseReason(offered()), null);
  });

  it("never releases a plant UPT marked Not Available", () => {
    for (const requestStatus of ["Pending", "Expired"]) {
      assert.equal(
        exactPlantReleaseReason({
          hasOfferItem: true,
          offerAvailability: "not_available",
          requestStatus,
          responseChoice: "unavailable",
        }),
        null,
      );
    }
  });

  it("never releases a plant that was never offered", () => {
    assert.equal(
      exactPlantReleaseReason({ hasOfferItem: false, requestStatus: "Expired" }),
      null,
    );
  });

  it("never releases a sold plant, however the request ended", () => {
    // Paid and Closed requests are out of scope; the plant is gone.
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Closed", paidAt: new Date() }),
      ),
      null,
    );
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "reject", requestStatus: "Closed" }),
      ),
      null,
    );
    // A declined item on a request that was paid for other plants stays sold-safe.
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "reject", paidAt: new Date() }),
      ),
      null,
    );
  });

  it("agrees with isExactPlantEligible", () => {
    assert.equal(isExactPlantEligible(offered({ responseChoice: "reject" })), true);
    assert.equal(isExactPlantEligible(offered({ responseChoice: "accept" })), false);
  });

  it("labels every reason for the admin", () => {
    for (const reason of [
      "customer_declined",
      "accepted_unpaid_expired",
      "never_responded_expired",
    ] as const) {
      assert.ok(EXACT_PLANT_RELEASE_LABELS[reason].length > 0);
    }
    assert.equal(EXACT_PLANT_RELEASE_LABELS.customer_declined, "Customer Declined");
  });
});

describe("exact plant ineligibility messages", () => {
  it("says nothing when the plant is eligible", () => {
    assert.equal(
      exactPlantIneligibilityReason(offered({ responseChoice: "reject" })),
      null,
    );
  });

  it("explains a Not Available plant", () => {
    assert.match(
      exactPlantIneligibilityReason({
        hasOfferItem: true,
        offerAvailability: "not_available",
        requestStatus: "Expired",
      }) ?? "",
      /Not Available/,
    );
  });

  it("explains a live hold", () => {
    assert.match(
      exactPlantIneligibilityReason(offered({ responseChoice: "accept" })) ?? "",
      /has not expired yet/,
    );
  });

  it("explains a paid request", () => {
    assert.match(
      exactPlantIneligibilityReason(
        offered({ responseChoice: "reject", paidAt: new Date() }),
      ) ?? "",
      /paid and closed/,
    );
  });

  it("explains a plant that was never offered", () => {
    assert.match(
      exactPlantIneligibilityReason({ hasOfferItem: false }) ?? "",
      /never offered/,
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
      requestNumber: "REQ8",
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
