import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  itemEditorSections,
  itemPhotos,
  offerFieldsEnabled,
  reorderPhotos,
  routeOf,
  showsExactPlantFields,
  showsStockSearch,
  stockDropdownOpen,
  THUMB_PAD,
  THUMB_REMOVE_SIZE,
  THUMB_SIZE,
} from "./item-editor";
import type { RequestItem } from "./types";

function item(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "item-1",
    plantName: "Monstera",
    offeredName: "Monstera Albo",
    availability: "available",
    fulfillmentType: "exact_plant",
    price: 250,
    weightLbs: 8,
    customerFacingNotes: "scar",
    adminNotes: "",
    photoUrls: [],
    photos: [
      { id: "p1", url: "https://cdn.example/1.jpg" },
      { id: "p2", url: "https://cdn.example/2.jpg" },
    ],
    ...overrides,
  };
}

describe("item editor rules", () => {
  it("disables offer fields only for Not Available", () => {
    assert.equal(offerFieldsEnabled("exact_plant"), true);
    assert.equal(offerFieldsEnabled("growers_choice"), true);
    assert.equal(offerFieldsEnabled("not_available"), false);
    assert.equal(routeOf(item({ availability: "not_available" })), "not_available");
  });

  it("uses compact photos and never invents a hero image list", () => {
    assert.deepEqual(
      itemPhotos(item()).map((photo) => photo.id),
      ["p1", "p2"],
    );
    assert.deepEqual(
      itemPhotos(
        item({
          photos: [],
          linkedStock: {
            productTitle: "Stock",
            variantTitle: "Default",
            variantGid: "gid://shopify/ProductVariant/1",
            imageUrl: "https://cdn.example/stock.jpg",
          },
        }),
      ),
      [{ id: "linked-stock", url: "https://cdn.example/stock.jpg" }],
    );
  });

  it("reorders photos without changing other fields", () => {
    const photos = item().photos;
    const next = reorderPhotos(photos, 0, 1);
    assert.deepEqual(
      next.map((photo) => photo.id),
      ["p2", "p1"],
    );
    assert.equal(item().price, 250);
    assert.equal(item().weightLbs, 8);
    assert.equal(item().customerFacingNotes, "scar");
  });

  it("hides Exact Plant fields in Link Stock and keeps them for Exact Plant", () => {
    assert.equal(showsExactPlantFields("exact_plant"), true);
    assert.equal(showsExactPlantFields("growers_choice"), false);
    assert.equal(showsStockSearch("growers_choice"), true);
    assert.deepEqual(itemEditorSections("growers_choice"), [
      "fulfillment",
      "stock-search",
      "linked-stock",
      "customer-facing-notes",
      "save-item",
    ]);
    assert.ok(itemEditorSections("growers_choice").indexOf("stock-search") <
      itemEditorSections("growers_choice").indexOf("customer-facing-notes"));
    assert.ok(!itemEditorSections("growers_choice").includes("offered-name"));
    assert.ok(itemEditorSections("exact_plant").includes("offered-name"));
    assert.ok(itemEditorSections("exact_plant").includes("price"));
    assert.ok(THUMB_SIZE > 48);
    assert.ok(THUMB_PAD + THUMB_REMOVE_SIZE > THUMB_REMOVE_SIZE);
  });

  it("keeps the stock dropdown attached to the input", () => {
    assert.equal(stockDropdownOpen(true, "albo", false, true, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, true), false);
    assert.equal(stockDropdownOpen(false, "", false, false, false), false);
  });
});
