import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  STOCK_SEARCH_NO_STOCK_COLOR,
  STOCK_SEARCH_NO_STOCK_LABEL,
  canSelectStockCandidate,
  formatStockSearchInventory,
  stockSearchInventoryIsEmpty,
} from "./stock-search";

describe("iOS Link Stock inventory labels", () => {
  it("shows a singular 1 in stock and plural quantities from the API payload", () => {
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 1 }),
      "1 in stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 2 }),
      "2 in stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 12 }),
      "12 in stock",
    );
  });

  it("shows No stock when available inventory is zero", () => {
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 0 }),
      "No stock",
    );
    assert.equal(formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 0 }), STOCK_SEARCH_NO_STOCK_LABEL);
    assert.equal(stockSearchInventoryIsEmpty({ inventoryTracked: true, inventoryQuantity: 0 }), true);
    assert.equal(stockSearchInventoryIsEmpty({ inventoryTracked: true, inventoryQuantity: 3 }), false);
  });

  it("keeps untracked variants out of the No stock path", () => {
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: false, inventoryQuantity: null }),
      "Not tracked",
    );
    assert.equal(
      stockSearchInventoryIsEmpty({ inventoryTracked: false, inventoryQuantity: null }),
      false,
    );
  });

  it("marks No stock with the same error red the website uses", () => {
    assert.equal(STOCK_SEARCH_NO_STOCK_COLOR, "#8e1f0b");
    const editor = readFileSync(path.join(import.meta.dirname, "components", "ItemEditor.tsx"), "utf8");
    assert.match(editor, /STOCK_SEARCH_NO_STOCK_COLOR/);
    assert.match(editor, /styles\.noStock/);
    assert.match(editor, /styles\.inStock/);
    assert.doesNotMatch(editor, /dropdownRowOff/);
  });

  it("lets an in-stock result stay selectable and blocks a zero-stock result", () => {
    assert.equal(
      canSelectStockCandidate({
        unlinkableReason: null,
        inventoryTracked: true,
        inventoryQuantity: 2,
      }),
      true,
    );
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
        unlinkableReason: "This variant is out of stock.",
        inventoryTracked: true,
        inventoryQuantity: 0,
      }),
      false,
    );
  });
});
