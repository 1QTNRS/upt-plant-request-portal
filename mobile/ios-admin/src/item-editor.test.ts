import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  itemEditorSections,
  itemPhotos,
  offerFieldsEnabled,
  reorderPhotos,
  requestPageKeyboardDismissMode,
  requestPageKeyboardShouldPersistTaps,
  requestPageScrollEnabledWhileStockOpen,
  routeOf,
  shouldDismissStockSearch,
  showsExactPlantFields,
  showsStockSearch,
  stockDropdownAfterFulfillmentChange,
  stockDropdownAfterNavigateAway,
  stockDropdownAfterOutsideDismiss,
  stockDropdownOpen,
  stockSearchConsumesOutsidePress,
  TAB_BAR_LABEL_FONT_SIZE,
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
      "autosave",
    ]);
    assert.ok(itemEditorSections("growers_choice").indexOf("stock-search") <
      itemEditorSections("growers_choice").indexOf("customer-facing-notes"));
    assert.ok(!itemEditorSections("growers_choice").includes("offered-name"));
    assert.ok(itemEditorSections("exact_plant").includes("offered-name"));
    assert.ok(itemEditorSections("exact_plant").includes("price"));
    assert.ok(THUMB_SIZE > 48);
    assert.ok(THUMB_PAD + THUMB_REMOVE_SIZE > THUMB_REMOVE_SIZE);
    assert.ok(TAB_BAR_LABEL_FONT_SIZE >= 14);
    assert.ok(TAB_BAR_LABEL_FONT_SIZE <= 16);
  });

  it("keeps the stock dropdown attached to the input", () => {
    assert.equal(stockDropdownOpen(true, "albo", false, true, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, true), false);
    assert.equal(stockDropdownOpen(false, "", false, false, false), false);
  });

  it("opens during search and closes on outside tap without selecting a result", () => {
    assert.equal(stockDropdownOpen(true, "albo", true, false, false), true);
    const dismissed = stockDropdownAfterOutsideDismiss();
    assert.equal(stockDropdownOpen(dismissed.focused, "albo", true, false, dismissed.closed), false);
    assert.equal(shouldDismissStockSearch("outside"), true);
    assert.equal(shouldDismissStockSearch("page-control"), true);
    assert.equal(shouldDismissStockSearch("input"), false);
    assert.equal(shouldDismissStockSearch("dropdown"), false);
    assert.equal(shouldDismissStockSearch("result"), false);
    assert.equal(stockSearchConsumesOutsidePress("input"), true);
    assert.equal(stockSearchConsumesOutsidePress("dropdown"), true);
    assert.equal(stockSearchConsumesOutsidePress("result"), true);
    assert.equal(stockSearchConsumesOutsidePress("outside"), false);
  });

  it("closes on fulfillment change and resets when leaving the request", () => {
    assert.equal(shouldDismissStockSearch("fulfillment"), true);
    const switched = stockDropdownAfterFulfillmentChange();
    assert.equal(stockDropdownOpen(switched.focused, "albo", true, false, switched.closed), false);
    assert.equal(switched.term, "");
    assert.equal(switched.resultsCleared, true);
    const left = stockDropdownAfterNavigateAway();
    assert.equal(stockDropdownOpen(left.focused, "albo", true, false, left.closed), false);
    assert.equal(left.resultsCleared, true);
  });

  it("keeps the request page scrollable and lets the keyboard dismiss outside search", () => {
    assert.equal(requestPageScrollEnabledWhileStockOpen(), true);
    assert.equal(requestPageKeyboardShouldPersistTaps(), "handled");
    assert.equal(requestPageKeyboardDismissMode(), "on-drag");
  });
});
