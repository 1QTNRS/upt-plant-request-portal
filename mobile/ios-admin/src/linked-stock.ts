import { formatStockSearchInventory } from "./stock-search";

export const unlinkPreservesNotes = true;
export const unlinkTouchesShopifyProduct = false;

export function unlinkStockPreservesNotes(): boolean {
  return unlinkPreservesNotes;
}

export function unlinkStockTouchesShopifyProduct(): boolean {
  return unlinkTouchesShopifyProduct;
}

export function showsStockSearchInput(input: {
  hasLinkedStock: boolean;
  changingStock: boolean;
}): boolean {
  return !input.hasLinkedStock || input.changingStock;
}

export function linkedStockSummary(input: {
  title?: string;
  productTitle?: string;
  variantTitle?: string;
  price: number;
  quantity?: number;
  inventoryQuantity?: number;
  inventoryTracked?: boolean | null;
}): { title: string; variant: string; detail: string; meta: string } {
  const title = input.title ?? input.productTitle ?? "";
  const rawVariant = input.variantTitle?.trim() ?? "";
  const variant = rawVariant && rawVariant !== "Default Title" ? rawVariant : "";
  const quantity = input.quantity ?? input.inventoryQuantity ?? 0;
  const detail = `$${input.price.toFixed(2)} · ${formatStockSearchInventory({
    inventoryQuantity: quantity,
    inventoryTracked: input.inventoryTracked,
  })}`;
  return { title, variant, detail, meta: detail };
}

export function changeStockUnblocksDropdown(): { changingStock: boolean; stockClosed: boolean } {
  return { changingStock: true, stockClosed: false };
}
