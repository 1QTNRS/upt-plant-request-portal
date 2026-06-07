export type OfferPlantItem = {
  id: string;
  plantName: string;
  price: number;
  photoUrl: string;
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
    {
      id: "offer-1",
      plantName: "Bird of Paradise",
      price: 150,
      photoUrl: "https://picsum.photos/seed/birdofparadise/400/400",
      notesFromUpt:
        "Please note: this exact plant has one older leaf with cosmetic damage, but the newest growth is healthy.",
    },
    {
      id: "offer-2",
      plantName: "Monstera Deliciosa",
      price: 85,
      photoUrl: "https://picsum.photos/seed/monstera-offer/400/400",
      notesFromUpt:
        "This is the exact plant shown in the photo. Leaf size and fenestration match what you requested.",
    },
  ],
};
