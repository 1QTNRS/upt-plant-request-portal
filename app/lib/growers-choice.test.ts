import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildStockSearchQuery,
  formatLinkedInventory,
  formatStockSearchInventory,
  inventoryHoldState,
  isEligibleStockSearchResult,
  linkedStockShortfall,
  reservationFailureMessage,
  reservationShortfalls,
  resolveFulfillmentType,
  resolveLinkedWeightLbs,
  stockSearchInventoryIsEmpty,
  stockSearchShopifyQuery,
  unlinkableVariantReason,
  weightInPounds,
  type LiveVariantStock,
  type StockVariantCandidate,
} from "./growers-choice";

function candidate(
  overrides: Partial<StockVariantCandidate> = {},
): StockVariantCandidate {
  return {
    productGid: "gid://shopify/Product/1",
    productTitle: "Monstera Thai Constellation",
    productHandle: "monstera-thai-constellation",
    productStatus: "ACTIVE",
    publishedOnOnlineStore: true,
    variantGid: "gid://shopify/ProductVariant/1",
    variantTitle: "6 inch",
    sku: "MTC-6",
    price: 285,
    inventoryQuantity: 3,
    inventoryTracked: true,
    availableForSale: true,
    weightLbs: 4.5,
    imageUrl: "https://cdn.shopify.com/mtc.jpg",
    ...overrides,
  };
}

function live(overrides: Partial<LiveVariantStock> = {}): LiveVariantStock {
  return {
    variantGid: "gid://shopify/ProductVariant/1",
    productStatus: "ACTIVE",
    availableForSale: true,
    inventoryTracked: true,
    inventoryQuantity: 3,
    ...overrides,
  };
}

describe("which route a plant is on", () => {
  it("reads Not Available from availability, whatever route was stored", () => {
    assert.equal(
      resolveFulfillmentType({
        availability: "not_available",
        fulfillmentType: "growers_choice",
      }),
      "not_available",
      "a plant UPT cannot supply must not be put back in the draft order by a stale route",
    );
  });

  it("treats an item with no route recorded as the exact plant it was", () => {
    assert.equal(
      resolveFulfillmentType({ availability: "available", fulfillmentType: null }),
      "exact_plant",
    );
  });
});

describe("whether a variant may be linked", () => {
  it("accepts a purchasable, priced, in-stock variant", () => {
    assert.equal(unlinkableVariantReason(candidate()), null);
  });

  it("accepts a variant Shopify does not count, which is not the same as none", () => {
    assert.equal(
      unlinkableVariantReason(
        candidate({ inventoryTracked: false, inventoryQuantity: null }),
      ),
      null,
    );
  });

  it("refuses an out-of-stock variant", () => {
    assert.match(
      unlinkableVariantReason(candidate({ inventoryQuantity: 0 })) ?? "",
      /out of stock/i,
    );
  });

  it("refuses a product a customer could not buy", () => {
    assert.match(
      unlinkableVariantReason(candidate({ productStatus: "DRAFT" })) ?? "",
      /not active/i,
    );
    assert.match(
      unlinkableVariantReason(candidate({ availableForSale: false })) ?? "",
      /not available for sale/i,
    );
  });

  it("refuses a variant with no price, which would be offered for nothing", () => {
    assert.match(unlinkableVariantReason(candidate({ price: 0 })) ?? "", /no price/i);
  });

  it("refuses a product that is not on the Online Store", () => {
    assert.match(
      unlinkableVariantReason(candidate({ publishedOnOnlineStore: false })) ?? "",
      /Online Store/,
    );
  });
});

describe("which search hits the admin is allowed to see", () => {
  it("keeps ACTIVE Online Store variants, including those with no stock", () => {
    assert.equal(isEligibleStockSearchResult(candidate()), true);
    assert.equal(isEligibleStockSearchResult(candidate({ inventoryQuantity: 0 })), true);
  });

  it("hides draft, archived, and unpublished products", () => {
    assert.equal(isEligibleStockSearchResult(candidate({ productStatus: "DRAFT" })), false);
    assert.equal(
      isEligibleStockSearchResult(candidate({ productStatus: "ARCHIVED" })),
      false,
    );
    assert.equal(
      isEligibleStockSearchResult(candidate({ publishedOnOnlineStore: false })),
      false,
    );
  });

  it("adds status:active to the Shopify search without changing the typed words", () => {
    assert.equal(stockSearchShopifyQuery("monst thai"), "monst* thai* status:active");
    assert.equal(stockSearchShopifyQuery("a"), null);
  });

  it("labels tracked inventory as X in stock or No stock", () => {
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 12 }),
      "12 in stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 1 }),
      "1 in stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 0 }),
      "No stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: false, inventoryQuantity: null }),
      "Not tracked",
    );
    assert.equal(
      stockSearchInventoryIsEmpty({ inventoryTracked: true, inventoryQuantity: 0 }),
      true,
    );
    assert.equal(
      stockSearchInventoryIsEmpty({ inventoryTracked: true, inventoryQuantity: 3 }),
      false,
    );
    assert.equal(
      stockSearchInventoryIsEmpty({ inventoryTracked: false, inventoryQuantity: null }),
      false,
    );
  });
});

describe("stock behind a linked listing", () => {
  it("counts nothing short when Shopify does not track the variant", () => {
    assert.equal(
      linkedStockShortfall({ inventoryTracked: false, inventoryQuantity: null, quantity: 3 }),
      0,
    );
  });

  it("counts the gap when there are fewer than asked for", () => {
    assert.equal(
      linkedStockShortfall({ inventoryTracked: true, inventoryQuantity: 1, quantity: 3 }),
      2,
    );
  });

  it("describes not-tracked and none-left differently", () => {
    assert.match(
      formatLinkedInventory({ inventoryTracked: false }),
      /not tracked/i,
    );
    assert.equal(
      formatLinkedInventory({ inventoryTracked: true, inventoryQuantity: 0 }),
      "0 in stock",
    );
  });
});

describe("the weight a Grower's Choice line ships on", () => {
  it("prefers the linked variant's own weight", () => {
    assert.equal(
      resolveLinkedWeightLbs({ linkedVariantWeightLbs: 4.5, weightLbs: 12 }),
      4.5,
    );
  });

  it("falls back to the item when the merchant never weighed the variant", () => {
    assert.equal(resolveLinkedWeightLbs({ linkedVariantWeightLbs: 0, weightLbs: 12 }), 12);
    assert.equal(resolveLinkedWeightLbs({ weightLbs: 12 }), 12);
  });

  it("converts whatever unit the merchant chose into pounds", () => {
    assert.equal(weightInPounds(2, "POUNDS"), 2);
    assert.equal(weightInPounds(32, "OUNCES"), 2);
    assert.equal(weightInPounds(1, "KILOGRAMS"), 2.2);
    assert.equal(weightInPounds(2000, "GRAMS"), 4.4);
  });

  it("returns nothing for a unit it does not know, rather than a wrong number", () => {
    assert.equal(weightInPounds(2, "STONES"), null);
    assert.equal(weightInPounds(null, "POUNDS"), null);
  });
});

describe("the Shopify search query the admin's words become", () => {
  it("wildcards each word so a partial name still finds the plant", () => {
    assert.equal(buildStockSearchQuery("monst thai"), "monst* thai*");
  });

  it("drops the punctuation Shopify would read as syntax", () => {
    // A colon is a field separator, a leading dash is NOT, and quotes delimit a
    // phrase — a merchant typing any of them would search for something else.
    assert.equal(buildStockSearchQuery('sku:"MTC-6"'), "sku* mtc-6*");
    assert.equal(buildStockSearchQuery("-monstera"), "monstera*");
  });

  it("asks nothing at all for a term too short to mean anything", () => {
    assert.equal(buildStockSearchQuery(""), null);
    assert.equal(buildStockSearchQuery("   "), null);
    assert.equal(buildStockSearchQuery("a"), null);
  });
});

describe("re-checking stock before it is held", () => {
  const request = {
    itemId: "item-1",
    plantName: "Monstera Thai Constellation",
    variantGid: "gid://shopify/ProductVariant/1",
    quantity: 1,
  };

  it("passes when the stock is still there", () => {
    assert.deepEqual(reservationShortfalls([request], [live()]), []);
  });

  it("passes an untracked variant, which has nothing to be short of", () => {
    assert.deepEqual(
      reservationShortfalls(
        [request],
        [live({ inventoryTracked: false, inventoryQuantity: null })],
      ),
      [],
    );
  });

  it("blocks when the last one sold while the customer was deciding", () => {
    const shortfalls = reservationShortfalls([request], [live({ inventoryQuantity: 0 })]);
    assert.equal(shortfalls.length, 1);
    assert.equal(shortfalls[0].itemId, "item-1");
    assert.match(shortfalls[0].reason, /Monstera Thai Constellation/);
    assert.match(shortfalls[0].reason, /only 0 of the 1 needed/);
  });

  it("blocks when the linked listing has gone entirely", () => {
    const shortfalls = reservationShortfalls([request], []);
    assert.equal(shortfalls.length, 1);
    assert.match(shortfalls[0].reason, /no longer exists/);
  });

  it("blocks when the merchant has unpublished the product", () => {
    const shortfalls = reservationShortfalls(
      [request],
      [live({ productStatus: "ARCHIVED" })],
    );
    assert.match(shortfalls[0].reason, /no longer active/);
  });

  it("sums two accepted plants sharing one listing, so one unit cannot sell twice", () => {
    const shortfalls = reservationShortfalls(
      [
        request,
        { ...request, itemId: "item-2", plantName: "Monstera Thai Constellation #2" },
      ],
      [live({ inventoryQuantity: 1 })],
    );

    assert.equal(shortfalls.length, 1, "one listing, one complaint");
    assert.match(shortfalls[0].reason, /only 1 of the 2 needed/);
  });

  it("names every plant the merchant has to do something about", () => {
    const message = reservationFailureMessage(
      reservationShortfalls([request], [live({ inventoryQuantity: 0 })]),
    );
    assert.match(message, /answer is saved/);
    assert.match(message, /nothing has been charged/);
    assert.match(message, /Monstera Thai Constellation/);
  });
});

describe("whether Shopify is still holding the stock", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const later = new Date("2026-08-25T12:00:00.000Z");
  const earlier = new Date("2026-08-20T12:00:00.000Z");

  it("reports no hold on an order that never asked for one", () => {
    assert.equal(inventoryHoldState({ now }), "none");
  });

  it("reports the hold while the customer's deadline is still running", () => {
    assert.equal(inventoryHoldState({ reserveInventoryUntil: later, now }), "held");
  });

  it("reports it released once the deadline has passed unpaid", () => {
    // Shopify lets it go by itself at that moment, which is what makes the
    // release survive the portal being down.
    assert.equal(inventoryHoldState({ reserveInventoryUntil: earlier, now }), "released");
  });

  it("reports a paid order as a real deduction rather than a hold", () => {
    assert.equal(
      inventoryHoldState({ reserveInventoryUntil: later, paidAt: now, now }),
      "purchased",
    );
  });
});

describe("website stock typeahead", () => {
  it("searches as the admin types and links from the dropdown", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(source, /data-stock-search-dropdown/);
    assert.match(source, /data-stock-search-option/);
    assert.match(source, /data-stock-search-inventory/);
    assert.match(source, /data-stock-search-no-stock/);
    assert.match(source, /formatStockSearchInventory/);
    assert.match(source, /stockSearchInventoryIsEmpty/);
    assert.match(source, /#8e1f0b/);
    assert.match(source, /setTimeout/);
    assert.match(source, /intent", "link-stock"/);
    assert.match(source, /candidate.imageUrl/);
    assert.match(source, /ArrowDown/);
    assert.match(source, /ArrowUp/);
    assert.match(source, /maxHeight: 280/);
    assert.match(source, /overflowY: "auto"/);
    assert.equal(source.includes("Search Shopify"), false);
    assert.equal(source.includes("Link this variant"), false);
  });
});
