import type { StockCandidate } from "./types";

export function formatStockSearchInventory(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
}): string {
  if (input.inventoryTracked === false) return "Not tracked";
  const quantity = input.inventoryQuantity ?? 0;
  if (quantity < 1) return "No stock";
  return `${quantity} in stock`;
}

export function stockSearchInventoryIsEmpty(input: {
  inventoryTracked?: boolean | null;
  inventoryQuantity?: number | null;
}): boolean {
  if (input.inventoryTracked === false) return false;
  return (input.inventoryQuantity ?? 0) < 1;
}

export function canSelectStockCandidate(candidate: Pick<StockCandidate, "unlinkableReason">): boolean {
  return !candidate.unlinkableReason;
}
