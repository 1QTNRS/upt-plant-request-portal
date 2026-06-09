const ITEM_AVAILABILITY_STORAGE_KEY = "upt-item-availability";

export type ItemAvailabilityStatus = "available" | "not_available";

export type UnavailableReason =
  | "Currently not in UPT prop circulation"
  | "Available in 2+ mos"
  | "Available in 2-3 weeks"
  | "Not in UPT's current inventory";

export const UNAVAILABLE_REASON_OPTIONS: UnavailableReason[] = [
  "Currently not in UPT prop circulation",
  "Available in 2+ mos",
  "Available in 2-3 weeks",
  "Not in UPT's current inventory",
];

export type ItemAvailabilityState = {
  availability: ItemAvailabilityStatus;
  unavailableReason: UnavailableReason;
};

const DEFAULT_UNAVAILABLE_REASON: UnavailableReason =
  "Not in UPT's current inventory";

const availabilityByItemId = new Map<string, ItemAvailabilityState>();
let itemAvailabilityHydrated = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function persistItemAvailability(): void {
  if (!isBrowser()) return;

  const stored: Record<string, ItemAvailabilityState> = {};
  for (const [itemId, state] of availabilityByItemId.entries()) {
    stored[itemId] = state;
  }

  localStorage.setItem(ITEM_AVAILABILITY_STORAGE_KEY, JSON.stringify(stored));
}

export function hydrateItemAvailability(): void {
  if (!isBrowser() || itemAvailabilityHydrated) return;

  itemAvailabilityHydrated = true;

  try {
    const raw = localStorage.getItem(ITEM_AVAILABILITY_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Record<string, ItemAvailabilityState>;
    for (const [itemId, state] of Object.entries(parsed)) {
      availabilityByItemId.set(itemId, {
        availability: state.availability,
        unavailableReason:
          state.unavailableReason ?? DEFAULT_UNAVAILABLE_REASON,
      });
    }
  } catch {
    // Ignore invalid stored availability during local testing.
  }
}

export function getItemAvailabilityState(itemId: string): ItemAvailabilityState {
  hydrateItemAvailability();

  return (
    availabilityByItemId.get(itemId) ?? {
      availability: "available",
      unavailableReason: DEFAULT_UNAVAILABLE_REASON,
    }
  );
}

export function isItemAvailable(itemId: string): boolean {
  return getItemAvailabilityState(itemId).availability === "available";
}

export function setItemAvailability(
  itemId: string,
  availability: ItemAvailabilityStatus,
): void {
  hydrateItemAvailability();

  const current = getItemAvailabilityState(itemId);
  availabilityByItemId.set(itemId, {
    ...current,
    availability,
  });
  persistItemAvailability();
}

export function setUnavailableReason(
  itemId: string,
  unavailableReason: UnavailableReason,
): void {
  hydrateItemAvailability();

  const current = getItemAvailabilityState(itemId);
  availabilityByItemId.set(itemId, {
    ...current,
    unavailableReason,
  });
  persistItemAvailability();
}

export function resetItemAvailability(): void {
  availabilityByItemId.clear();
  itemAvailabilityHydrated = false;

  if (isBrowser()) {
    localStorage.removeItem(ITEM_AVAILABILITY_STORAGE_KEY);
  }
}
