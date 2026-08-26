import type { RequestItem } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 450;

export type ItemDraft = {
  offeredName: string;
  priceText: string;
  weightText: string;
  customerFacingNotes: string;
};

export type ParsedDecimal =
  | { ok: true; value: number; complete: true }
  | { ok: true; value: number; complete: false }
  | { ok: false };

export function parseDecimalInput(text: string): ParsedDecimal {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: 0, complete: true };
  if (trimmed === "." || trimmed === "-") return { ok: false };
  if (trimmed.endsWith(".")) {
    const head = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(head) || head < 0) return { ok: false };
    return { ok: true, value: head, complete: false };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { ok: false };
  return { ok: true, value, complete: true };
}

export function draftsEqual(left?: ItemDraft | null, right?: ItemDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.offeredName === right.offeredName &&
    left.priceText === right.priceText &&
    left.weightText === right.weightText &&
    left.customerFacingNotes === right.customerFacingNotes
  );
}

export function draftEqualsSaved(draft: ItemDraft, item: RequestItem): boolean {
  return (
    draft.offeredName === item.offeredName &&
    draft.customerFacingNotes === item.customerFacingNotes &&
    Number(draft.priceText) === item.price &&
    Number(draft.weightText) === item.weightLbs
  );
}

export function shouldDebounceSave(draft: ItemDraft): boolean {
  const price = parseDecimalInput(draft.priceText);
  const weight = parseDecimalInput(draft.weightText);
  return price.ok && price.complete && weight.ok && weight.complete;
}

export function draftToSavePayload(draft: ItemDraft): {
  offeredName: string;
  price: number;
  weightLbs: number;
  customerFacingNotes: string;
} {
  const price = parseDecimalInput(draft.priceText);
  const weight = parseDecimalInput(draft.weightText);
  return {
    offeredName: draft.offeredName,
    price: price.ok ? price.value : 0,
    weightLbs: weight.ok ? weight.value : 0,
    customerFacingNotes: draft.customerFacingNotes,
  };
}

export function applyItemDraft(item: RequestItem, draft?: ItemDraft | null): RequestItem {
  if (!draft) return item;
  const saved = draftToSavePayload(draft);
  return {
    ...item,
    offeredName: saved.offeredName || item.offeredName,
    price: saved.price,
    weightLbs: saved.weightLbs,
    customerFacingNotes: saved.customerFacingNotes,
  };
}

export function itemLooksSendable(item: RequestItem): boolean {
  if (item.availability === "not_available") return true;
  if (item.fulfillmentType === "growers_choice") {
    return Boolean(item.linkedStock?.variantGid);
  }
  return item.photos.length > 0 && item.price > 0 && item.weightLbs > 0;
}

export function requestLooksSendable(items: RequestItem[]): boolean {
  return items.length > 0 && items.every(itemLooksSendable);
}

export type AutosaveStatus = "idle" | "saving" | "saved" | "failed";

export function autosaveLabel(status: AutosaveStatus): string | null {
  if (status === "saving") return "Saving…";
  if (status === "saved") return "Saved";
  if (status === "failed") return "Couldn’t save";
  return null;
}
