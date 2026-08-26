import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  itemPhotos,
  offerFieldsEnabled,
  routeOf,
  stockDropdownOpen,
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

  it("keeps the stock dropdown attached to the input", () => {
    assert.equal(stockDropdownOpen(true, "albo", false, true, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, true), false);
    assert.equal(stockDropdownOpen(false, "", false, false, false), false);
  });
});
