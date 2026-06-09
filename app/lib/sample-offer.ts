import { getCustomerItemNote, hydrateCustomerItemNotes } from "./customer-item-notes";
import {
  getItemAvailabilityState,
  hydrateItemAvailability,
  isItemAvailable,
} from "./item-availability";
import { getOfferItemPrice, hydrateItemPricing } from "./item-pricing";
import {
  getRequestWithState,
  hydrateSampleOfferState,
} from "./sample-requests";

export type OfferPlantItem = {
  id: string;
  sourceItemId: string;
  plantName: string;
  price: number;
  photoUrl: string;
  photoUrls: string[];
  notesFromUpt: string;
};

export type SampleCustomerOffer = {
  title: string;
  expirationDays: number;
  expiresAt: string;
  urgencyMessage: string;
  holdMessage: string;
  fedexUpgradeLabel: string;
  fedexUpgradePrice: number;
  customerEmail: string;
  items: OfferPlantItem[];
};

function buildPhotoUrls(sourceItemId: string, primaryUrl: string): string[] {
  return [
    primaryUrl,
    `https://picsum.photos/seed/${sourceItemId}-angle2/800/800`,
    `https://picsum.photos/seed/${sourceItemId}-angle3/800/800`,
  ];
}

function toOfferPlantItem(
  item: {
    id: string;
    sourceItemId: string;
    plantName: string;
    price: number;
    photoUrl: string;
    notesFromUpt: string;
  },
  includeGallery: boolean,
): OfferPlantItem {
  return {
    ...item,
    photoUrls: includeGallery
      ? buildPhotoUrls(item.sourceItemId, item.photoUrl)
      : [item.photoUrl],
  };
}

export const SAMPLE_CUSTOMER_OFFER: SampleCustomerOffer = {
  title: "Your Personal Plant Offer from UPT",
  expirationDays: 3,
  expiresAt: "June 9 at 5:00 PM PT",
  urgencyMessage:
    "These exact plants are reserved for you. Review and respond before this offer expires.",
  holdMessage:
    "These exact plants are being held for you until June 9 at 5:00 PM PT. After that, this offer may be released.",
  fedexUpgradeLabel: "FedEx Priority Overnight Upgrade",
  fedexUpgradePrice: 15,
  customerEmail: "emily.r@email.com",
  items: [
    toOfferPlantItem(
      {
        id: "offer-1",
        sourceItemId: "3-1",
        plantName: "Bird of Paradise",
        price: 150,
        photoUrl: "https://picsum.photos/seed/birdofparadise/400/400",
        notesFromUpt:
          "Please note: this exact plant has one older leaf with cosmetic damage, but the newest growth is healthy.",
      },
      true,
    ),
    toOfferPlantItem(
      {
        id: "offer-2",
        sourceItemId: "1-1",
        plantName: "Monstera Deliciosa",
        price: 85,
        photoUrl: "https://picsum.photos/seed/monstera-offer/400/400",
        notesFromUpt:
          "This is the exact plant shown in the photo. Leaf size and fenestration match what you requested.",
      },
      true,
    ),
    toOfferPlantItem(
      {
        id: "offer-3",
        sourceItemId: "1-2",
        plantName: "Fiddle Leaf Fig",
        price: 120,
        photoUrl: "https://picsum.photos/seed/fiddleleaf/400/400",
        notesFromUpt:
          "We were unable to source this exact plant for your offer window.",
      },
      false,
    ),
  ],
};

export function buildCustomerOfferFromRequest(
  requestId: string,
): SampleCustomerOffer | null {
  hydrateSampleOfferState();
  hydrateCustomerItemNotes();
  hydrateItemPricing();
  hydrateItemAvailability();

  const request = getRequestWithState(requestId);
  if (!request?.sentOffer) return null;

  const { sentOffer } = request;

  const items: OfferPlantItem[] = request.items.map((item, index) => {
    const available = isItemAvailable(item.id);
    const photoUrl = item.photoPreviewUrl;

    return toOfferPlantItem(
      {
        id: `offer-${requestId}-${index + 1}`,
        sourceItemId: item.id,
        plantName: item.plantName,
        price: getOfferItemPrice(item.id) || item.price || 0,
        photoUrl,
        notesFromUpt: getCustomerItemNote(item.id) || item.adminNotes || "",
      },
      available,
    );
  });

  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: sentOffer.expirationDays,
    expiresAt: sentOffer.expiresAt,
    urgencyMessage:
      "These exact plants are reserved for you. Review and respond before this offer expires.",
    holdMessage: `These exact plants are being held for you until ${sentOffer.expiresAt}. After that, this offer may be released.`,
    fedexUpgradeLabel: "FedEx Priority Overnight Upgrade",
    fedexUpgradePrice: 15,
    customerEmail: request.email,
    items,
  };
}
