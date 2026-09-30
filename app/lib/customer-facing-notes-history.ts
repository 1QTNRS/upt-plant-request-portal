import { resolveFulfillmentType } from "./growers-choice";

export type CustomerFacingNotesHistoryEntry = {
  sentAtIso: string;
  requestNumber: string;
  plantName: string;
  note: string;
};

type FrozenOfferItem = {
  plantName: string;
  customerFacingNotes: string;
  /** Original requested name — fallback when legacy snapshots left plantName blank. */
  requestedPlantName?: string;
};

type FrozenOffer = {
  sentAt: Date;
  items: FrozenOfferItem[];
};

/** Plant label frozen onto OfferItem when an offer is sent. */
export function frozenOfferItemPlantName(item: {
  availability: string;
  plantName: string;
  offeredName: string;
  fulfillmentType: string;
}): string {
  if (item.availability === "not_available") {
    return item.plantName.trim();
  }
  if (resolveFulfillmentType(item) === "growers_choice") {
    return (item.offeredName || item.plantName).trim();
  }
  return item.offeredName.trim();
}

export function resolveCustomerFacingHistoryPlantName(item: FrozenOfferItem): string {
  return item.plantName.trim() || (item.requestedPlantName ?? "").trim();
}

/** Notes frozen on OfferItem when the offer was sent — not live RequestItem drafts. */
export function customerFacingNotesHistoryFromOffer(
  offer: FrozenOffer | null | undefined,
  requestNumber: string,
): CustomerFacingNotesHistoryEntry[] {
  if (!offer) return [];
  const sentAtIso = offer.sentAt.toISOString();
  return offer.items
    .map((item) => ({
      sentAtIso,
      requestNumber,
      plantName: resolveCustomerFacingHistoryPlantName(item),
      note: item.customerFacingNotes.trim(),
    }))
    .filter((entry) => entry.note.length > 0);
}
