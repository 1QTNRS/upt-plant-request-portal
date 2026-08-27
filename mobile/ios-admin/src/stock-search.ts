import type { StockCandidate } from "./types";

/** Same red the website Link Stock dropdown uses for an empty variant. */
export const STOCK_SEARCH_NO_STOCK_COLOR = "#8e1f0b";
export const STOCK_SEARCH_NO_STOCK_LABEL = "No stock";

/**
 * Inventory line for one search row. Quantity is the variant's own
 * `inventoryQuantity` from the mobile API — the phone does not re-query Shopify.
 */
export function formatStockSearchInventory(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
}): string {
  if (input.inventoryTracked === false) return "Not tracked";
  const quantity = input.inventoryQuantity ?? 0;
  if (quantity < 1) return STOCK_SEARCH_NO_STOCK_LABEL;
  return `${quantity} in stock`;
}

export function stockSearchInventoryIsEmpty(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
}): boolean {
  if (input.inventoryTracked === false) return false;
  return (input.inventoryQuantity ?? 0) < 1;
}

export function canSelectStockCandidate(
  candidate: Pick<StockCandidate, "unlinkableReason"> & {
    inventoryTracked?: boolean | null;
    inventoryQuantity?: number | null;
  },
): boolean {
  if (candidate.unlinkableReason) return false;
  return !stockSearchInventoryIsEmpty(candidate);
}
