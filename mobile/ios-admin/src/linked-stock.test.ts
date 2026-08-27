import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  changeStockUnblocksDropdown,
  linkedStockSummary,
  showsStockSearchInput,
  unlinkPreservesNotes,
  unlinkStockPreservesNotes,
  unlinkStockTouchesShopifyProduct,
  unlinkTouchesShopifyProduct,
} from "./linked-stock";
import { canSelectStockCandidate } from "./stock-search";

describe("linked stock selected row", () => {
  it("hides the search input while a listing is linked unless changing", () => {
    assert.equal(showsStockSearchInput({ hasLinkedStock: true, changingStock: false }), false);
    assert.equal(showsStockSearchInput({ hasLinkedStock: true, changingStock: true }), true);
    assert.equal(showsStockSearchInput({ hasLinkedStock: false, changingStock: false }), true);
    assert.equal(showsStockSearchInput({ hasLinkedStock: false, changingStock: true }), true);
  });

  it("summarizes the linked listing as $price · N in stock", () => {
    assert.deepEqual(linkedStockSummary({ title: "Thai Constellation", price: 185, quantity: 3 }), {
      title: "Thai Constellation",
      variant: "",
      detail: "$185.00 · 3 in stock",
      meta: "$185.00 · 3 in stock",
    });
    assert.deepEqual(
      linkedStockSummary({
        productTitle: "Monstera",
        variantTitle: "Large",
        price: 40,
        inventoryQuantity: 1,
      }),
      {
        title: "Monstera",
        variant: "Large",
        detail: "$40.00 · 1 in stock",
        meta: "$40.00 · 1 in stock",
      },
    );
    assert.deepEqual(
      linkedStockSummary({
        productTitle: "Thai Constellation",
        variantTitle: "Default Title",
        price: 185,
        inventoryQuantity: 1,
        inventoryTracked: true,
      }),
      {
        title: "Thai Constellation",
        variant: "",
        detail: "$185.00 · 1 in stock",
        meta: "$185.00 · 1 in stock",
      },
    );
  });

  it("unlinks the portal row without touching notes or the Shopify product", () => {
    assert.equal(unlinkPreservesNotes, true);
    assert.equal(unlinkTouchesShopifyProduct, false);
    assert.equal(unlinkStockPreservesNotes(), true);
    assert.equal(unlinkStockTouchesShopifyProduct(), false);
  });

  it("reopens search on Change stock without the current link blocking the dropdown", () => {
    const next = changeStockUnblocksDropdown();
    assert.equal(next.changingStock, true);
    assert.equal(next.stockClosed, false);
    assert.equal(
      showsStockSearchInput({ hasLinkedStock: true, changingStock: next.changingStock }),
      true,
    );
  });

  it("still refuses a zero-stock replacement", () => {
    assert.equal(
      canSelectStockCandidate({
        unlinkableReason: null,
        inventoryTracked: true,
        inventoryQuantity: 0,
      }),
      false,
    );
    assert.equal(
      canSelectStockCandidate({
        unlinkableReason: null,
        inventoryTracked: true,
        inventoryQuantity: 2,
      }),
      true,
    );
  });

  it("wires Remove and Change stock in the editor without resetting notes", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(source, /intent: "unlink-stock"/);
    assert.match(source, /accessibilityLabel="Remove"/);
    assert.match(source, /Change stock/);
    assert.match(source, /showsStockSearchInput/);
    assert.match(source, /linkedStockSummary/);
    assert.match(source, /changeStockUnblocksDropdown/);
    assert.match(source, /setStockClosed\(false\)/);
    const unlinkAt = source.indexOf("function unlinkLinkedStock");
    assert.ok(unlinkAt > -1);
    const unlinkBlock = source.slice(unlinkAt, unlinkAt + 280);
    assert.match(unlinkBlock, /intent: "unlink-stock"/);
    assert.doesNotMatch(unlinkBlock, /setNotes/);
    assert.doesNotMatch(unlinkBlock, /customerFacingNotes/);
    assert.doesNotMatch(unlinkBlock, /setPendingPhotos/);
    assert.doesNotMatch(source, /Unlink listing/);
  });
});
