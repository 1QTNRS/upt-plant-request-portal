import { getPlantItemById } from "./sample-requests";

const ITEM_PRICING_STORAGE_KEY = "upt-item-pricing";

type ItemPricing = {
  price: number;
  weightLbs: number;
};

const pricingByItemId = new Map<string, ItemPricing>();
let itemPricingHydrated = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function persistItemPricing(): void {
  if (!isBrowser()) return;

  const stored: Record<string, ItemPricing> = {};
  for (const [itemId, pricing] of pricingByItemId.entries()) {
    stored[itemId] = pricing;
  }

  localStorage.setItem(ITEM_PRICING_STORAGE_KEY, JSON.stringify(stored));
}

export function hydrateItemPricing(): void {
  if (!isBrowser() || itemPricingHydrated) return;

  itemPricingHydrated = true;

  try {
    const raw = localStorage.getItem(ITEM_PRICING_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Record<string, ItemPricing>;
    for (const [itemId, pricing] of Object.entries(parsed)) {
      if (!pricing) continue;

      pricingByItemId.set(itemId, {
        price: normalizePrice(pricing.price),
        weightLbs: normalizeWeight(pricing.weightLbs),
      });
    }
  } catch {
    // Ignore invalid stored pricing during local testing.
  }
}

function normalizePrice(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

function normalizeWeight(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10) / 10;
}

export function getEffectiveItemPrice(
  itemId: string,
  defaultPrice: number,
): number {
  hydrateItemPricing();

  const stored = pricingByItemId.get(itemId);
  if (stored !== undefined) return stored.price;

  return normalizePrice(defaultPrice);
}

export function getEffectiveItemWeight(
  itemId: string,
  defaultWeightLbs: number,
): number {
  hydrateItemPricing();

  const stored = pricingByItemId.get(itemId);
  if (stored !== undefined) return stored.weightLbs;

  return normalizeWeight(defaultWeightLbs);
}

export function setItemPrice(itemId: string, price: number): void {
  hydrateItemPricing();

  const current = pricingByItemId.get(itemId) ?? {
    price: 0,
    weightLbs: getPlantItemById(itemId)?.weightLbs ?? 0,
  };

  pricingByItemId.set(itemId, {
    ...current,
    price: normalizePrice(price),
  });
  persistItemPricing();
}

export function setItemWeight(itemId: string, weightLbs: number): void {
  hydrateItemPricing();

  const current = pricingByItemId.get(itemId) ?? {
    price: getPlantItemById(itemId)?.price ?? 0,
    weightLbs: 0,
  };

  pricingByItemId.set(itemId, {
    ...current,
    weightLbs: normalizeWeight(weightLbs),
  });
  persistItemPricing();
}

export function getOfferItemPrice(sourceItemId: string): number {
  const plantItem = getPlantItemById(sourceItemId);
  return getEffectiveItemPrice(sourceItemId, plantItem?.price ?? 0);
}

export function resetItemPricing(): void {
  pricingByItemId.clear();
  itemPricingHydrated = false;

  if (isBrowser()) {
    localStorage.removeItem(ITEM_PRICING_STORAGE_KEY);
  }
}
