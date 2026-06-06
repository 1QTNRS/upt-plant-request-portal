export type RequestStatus =
  | "New"
  | "Awaiting Response"
  | "Offers Sent"
  | "Purchased"
  | "Expired";

export type PlantItemStatus =
  | "Requested"
  | "Sourced"
  | "Offered"
  | "Sold"
  | "Unavailable";

export type PlantItem = {
  id: string;
  plantName: string;
  quantity: number;
  itemStatus: PlantItemStatus;
  price: number;
  weightLbs: number;
  adminNotes: string;
  photoPreviewUrl: string;
};

export type PlantRequest = {
  id: string;
  customer: string;
  email: string;
  status: RequestStatus;
  submittedDate: string;
  items: PlantItem[];
};

export const SAMPLE_REQUESTS: PlantRequest[] = [
  {
    id: "1",
    customer: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    status: "New",
    submittedDate: "Jun 4, 2026",
    items: [
      {
        id: "1-1",
        plantName: "Monstera Deliciosa",
        quantity: 1,
        itemStatus: "Requested",
        price: 85,
        weightLbs: 12,
        adminNotes: "Customer prefers medium size with fenestrations.",
        photoPreviewUrl: "https://picsum.photos/seed/monstera/320/320",
      },
      {
        id: "1-2",
        plantName: "Fiddle Leaf Fig",
        quantity: 1,
        itemStatus: "Requested",
        price: 120,
        weightLbs: 18,
        adminNotes: "Needs to fit a bright corner spot.",
        photoPreviewUrl: "https://picsum.photos/seed/fiddleleaf/320/320",
      },
    ],
  },
  {
    id: "2",
    customer: "James Chen",
    email: "j.chen@email.com",
    status: "Awaiting Response",
    submittedDate: "Jun 3, 2026",
    items: [
      {
        id: "2-1",
        plantName: "Snake Plant",
        quantity: 2,
        itemStatus: "Sourced",
        price: 45,
        weightLbs: 8,
        adminNotes: "Low-light tolerant varieties only.",
        photoPreviewUrl: "https://picsum.photos/seed/snakeplant/320/320",
      },
      {
        id: "2-2",
        plantName: "ZZ Plant",
        quantity: 1,
        itemStatus: "Sourced",
        price: 55,
        weightLbs: 6,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/zzplant/320/320",
      },
      {
        id: "2-3",
        plantName: "Pothos",
        quantity: 1,
        itemStatus: "Requested",
        price: 28,
        weightLbs: 3,
        adminNotes: "Trailing variety preferred.",
        photoPreviewUrl: "https://picsum.photos/seed/pothos/320/320",
      },
    ],
  },
  {
    id: "3",
    customer: "Emily Rodriguez",
    email: "emily.r@email.com",
    status: "Offers Sent",
    submittedDate: "Jun 2, 2026",
    items: [
      {
        id: "3-1",
        plantName: "Bird of Paradise",
        quantity: 1,
        itemStatus: "Offered",
        price: 150,
        weightLbs: 22,
        adminNotes: "Offer sent with delivery estimate.",
        photoPreviewUrl: "https://picsum.photos/seed/birdofparadise/320/320",
      },
    ],
  },
  {
    id: "4",
    customer: "Michael Thompson",
    email: "m.thompson@email.com",
    status: "Purchased",
    submittedDate: "May 30, 2026",
    items: [
      {
        id: "4-1",
        plantName: "Rubber Plant",
        quantity: 1,
        itemStatus: "Sold",
        price: 65,
        weightLbs: 10,
        adminNotes: "Purchased and fulfilled.",
        photoPreviewUrl: "https://picsum.photos/seed/rubberplant/320/320",
      },
      {
        id: "4-2",
        plantName: "Peace Lily",
        quantity: 1,
        itemStatus: "Sold",
        price: 38,
        weightLbs: 5,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/peacelily/320/320",
      },
    ],
  },
  {
    id: "5",
    customer: "Lisa Park",
    email: "lisa.park@email.com",
    status: "Expired",
    submittedDate: "May 28, 2026",
    items: [
      {
        id: "5-1",
        plantName: "Calathea",
        quantity: 1,
        itemStatus: "Unavailable",
        price: 0,
        weightLbs: 4,
        adminNotes: "Could not source before offer expired.",
        photoPreviewUrl: "https://picsum.photos/seed/calathea/320/320",
      },
      {
        id: "5-2",
        plantName: "Alocasia",
        quantity: 1,
        itemStatus: "Unavailable",
        price: 0,
        weightLbs: 6,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/alocasia/320/320",
      },
    ],
  },
  {
    id: "6",
    customer: "David Wilson",
    email: "d.wilson@email.com",
    status: "New",
    submittedDate: "Jun 5, 2026",
    items: [
      {
        id: "6-1",
        plantName: "Philodendron Brasil",
        quantity: 1,
        itemStatus: "Requested",
        price: 32,
        weightLbs: 4,
        adminNotes: "Hanging basket if available.",
        photoPreviewUrl: "https://picsum.photos/seed/philodendron/320/320",
      },
      {
        id: "6-2",
        plantName: "Hoya",
        quantity: 1,
        itemStatus: "Requested",
        price: 40,
        weightLbs: 2,
        adminNotes: "",
        photoPreviewUrl: "https://picsum.photos/seed/hoya/320/320",
      },
    ],
  },
];

export function getRequestById(id: string): PlantRequest | undefined {
  return SAMPLE_REQUESTS.find((request) => request.id === id);
}

export function formatPlantsSummary(items: PlantItem[]): string {
  return items.map((item) => item.plantName).join(", ");
}
