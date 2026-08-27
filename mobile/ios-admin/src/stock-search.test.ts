import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSelectStockCandidate,
  formatStockSearchInventory,
  stockSearchInventoryIsEmpty,
} from "./stock-search";

describe("iOS Link Stock inventory labels", () => {
  it("shows X in stock, No stock, and Not tracked from the same payload", () => {
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 3 }),
      "3 in stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: true, inventoryQuantity: 0 }),
      "No stock",
    );
    assert.equal(
      formatStockSearchInventory({ inventoryTracked: false, inventoryQuantity: null }),
      "Not tracked",
    );
    assert.equal(stockSearchInventoryIsEmpty({ inventoryTracked: true, inventoryQuantity: 0 }), true);
    assert.equal(
      stockSearchInventoryIsEmpty({ inventoryTracked: false, inventoryQuantity: null }),
      false,
    );
  });

  it("refuses to select a zero-stock or otherwise unlinkable result", () => {
    assert.equal(canSelectStockCandidate({ unlinkableReason: null }), true);
    assert.equal(
      canSelectStockCandidate({ unlinkableReason: "This variant is out of stock." }),
      false,
    );
  });
});
