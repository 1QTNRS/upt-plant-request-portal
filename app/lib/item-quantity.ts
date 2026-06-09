import { getPlantItemById } from "./sample-requests";

export function hydrateItemQuantity(): void {
  // Quantity comes from sample request data only.
}

export function getEffectiveItemQuantity(
  itemId: string,
  requestedQuantity: number,
): number {
  return Math.max(1, Math.floor(requestedQuantity));
}

export function getOfferItemQuantity(sourceItemId: string): number {
  const plantItem = getPlantItemById(sourceItemId);
  return plantItem?.quantity ?? 1;
}
