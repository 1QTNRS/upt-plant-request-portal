/** True when at least one item on the upcoming offer can be bought. */
export function itemsHavePurchasableOffer(
  items: Array<{ availability?: string | null }>,
): boolean {
  return items.some((item) => item.availability === "available");
}

/**
 * Expiration, ADD ON and other payment-hold controls only apply when something
 * can be bought. The Send offer button itself stays available either way.
 */
export function sendOfferHoldControlsEnabled(
  items: Array<{ availability?: string | null }>,
): boolean {
  return itemsHavePurchasableOffer(items);
}
