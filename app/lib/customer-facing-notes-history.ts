export type CustomerFacingNotesHistoryEntry = {
  sentAtIso: string;
  requestNumber: string;
  plantName: string;
  note: string;
};

type FrozenOfferItem = {
  plantName: string;
  customerFacingNotes: string;
};

type FrozenOffer = {
  sentAt: Date;
  items: FrozenOfferItem[];
};

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
      plantName: item.plantName.trim(),
      note: item.customerFacingNotes.trim(),
    }))
    .filter((entry) => entry.note.length > 0);
}
