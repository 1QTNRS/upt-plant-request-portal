const CUSTOMER_ITEM_NOTES_STORAGE_KEY = "upt-customer-item-notes";

const customerNotesByItemId = new Map<string, string>();
let customerNotesHydrated = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function persistCustomerItemNotes(): void {
  if (!isBrowser()) return;

  const notes: Record<string, string> = {};
  for (const [itemId, note] of customerNotesByItemId.entries()) {
    notes[itemId] = note;
  }

  localStorage.setItem(
    CUSTOMER_ITEM_NOTES_STORAGE_KEY,
    JSON.stringify(notes),
  );
}

export function hydrateCustomerItemNotes(): void {
  if (!isBrowser() || customerNotesHydrated) return;

  customerNotesHydrated = true;

  try {
    const raw = localStorage.getItem(CUSTOMER_ITEM_NOTES_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [itemId, note] of Object.entries(parsed)) {
      customerNotesByItemId.set(itemId, note);
    }
  } catch {
    // Ignore invalid stored notes during local testing.
  }
}

export function getCustomerItemNote(itemId: string): string {
  hydrateCustomerItemNotes();
  return customerNotesByItemId.get(itemId) ?? "";
}

export function setCustomerItemNote(itemId: string, note: string): void {
  hydrateCustomerItemNotes();

  const trimmed = note.trim();
  if (trimmed) {
    customerNotesByItemId.set(itemId, trimmed);
  } else {
    customerNotesByItemId.delete(itemId);
  }

  persistCustomerItemNotes();
}

export function getCustomerItemNotesForIds(
  itemIds: string[],
): Record<string, string> {
  hydrateCustomerItemNotes();

  return Object.fromEntries(
    itemIds.map((itemId) => [itemId, getCustomerItemNote(itemId)]),
  );
}

export function resetCustomerItemNotes(): void {
  customerNotesByItemId.clear();
  customerNotesHydrated = false;

  if (isBrowser()) {
    localStorage.removeItem(CUSTOMER_ITEM_NOTES_STORAGE_KEY);
  }
}
