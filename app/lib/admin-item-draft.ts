import type { FulfillmentType } from "./growers-choice";
import type { UnavailableReason } from "./portal";

/**
 * The admin item fields that live in React state while the merchant types.
 * Photo actions revalidate the whole request, so these have to survive a
 * sibling item's upload without being overwritten by stale loader data.
 */
export type AdminItemDraft = {
  offeredName: string;
  customerFacingNotes: string;
  fulfillmentType: FulfillmentType;
  unavailableReason: UnavailableReason;
  price: number;
  weightLbs: number;
};

export type AdminItemDirty = Partial<Record<keyof AdminItemDraft, boolean>>;

export function mergeAdminItemDraft(
  local: AdminItemDraft,
  server: AdminItemDraft,
  dirty: AdminItemDirty,
): AdminItemDraft {
  return {
    offeredName: dirty.offeredName ? local.offeredName : server.offeredName,
    customerFacingNotes: dirty.customerFacingNotes
      ? local.customerFacingNotes
      : server.customerFacingNotes,
    fulfillmentType: dirty.fulfillmentType
      ? local.fulfillmentType
      : server.fulfillmentType,
    unavailableReason: dirty.unavailableReason
      ? local.unavailableReason
      : server.unavailableReason,
    price: dirty.price ? local.price : server.price,
    weightLbs: dirty.weightLbs ? local.weightLbs : server.weightLbs,
  };
}

/**
 * Draft text for a price/weight field. Strips a leading zero so typing "85"
 * into a field that showed "0" becomes "85", not "085". Keeps "0.5".
 */
export function sanitizeNumberDraft(raw: string): string {
  const allowed = raw.replace(/[^\d.]/g, "");
  if (!allowed) return "";

  const dot = allowed.indexOf(".");
  const wholeRaw = dot === -1 ? allowed : allowed.slice(0, dot);
  const fraction = dot === -1 ? null : allowed.slice(dot + 1).replace(/\./g, "");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");

  if (fraction !== null) {
    return `${whole || "0"}.${fraction}`;
  }
  return whole;
}

export function parseNumberDraft(raw: string): number {
  if (!raw.trim()) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Select-all on focus when the field is still an untouched zero. */
export function shouldSelectZeroOnFocus(display: string): boolean {
  return sanitizeNumberDraft(display) === "0";
}
