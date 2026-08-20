import prisma from "../db.server";
import { DEFAULT_FEDEX_REMOVAL_WARNING, DEFAULT_UNAVAILABLE_REASON } from "./portal";

type SeedItem = {
  plantName: string;
  availability?: "available" | "not_available";
  unavailableReason?: string;
  price?: number;
  weightLbs?: number;
  notes?: string;
  photoSeed?: string;
  customerNotes?: string;
};

type SeedRequest = {
  requestNumber: string;
  customerName: string;
  email: string;
  status: "New" | "Pending" | "Closed" | "Expired";
  submittedAt: Date;
  expirationDays?: 3 | 5 | 7;
  paidAt?: Date;
  closedAt?: Date;
  items: SeedItem[];
  response?: {
    accepted: string[];
    rejected: string[];
    fedexSelected: boolean;
  };
  plantRevenue?: number;
};

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

const SEED_REQUESTS: SeedRequest[] = [
  {
    requestNumber: "UPT-REQ-2026-000001",
    customerName: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    status: "New",
    submittedAt: daysAgo(2),
    items: [
      {
        plantName: "Monstera Deliciosa",
        price: 85,
        weightLbs: 12,
        customerNotes: "Customer prefers medium size with fenestrations.",
        photoSeed: "monstera",
      },
      {
        plantName: "Fiddle Leaf Fig",
        price: 120,
        weightLbs: 18,
        customerNotes: "Needs to fit a bright corner spot.",
        photoSeed: "fiddleleaf",
      },
    ],
  },
  {
    requestNumber: "UPT-REQ-2026-000002",
    customerName: "James Chen",
    email: "j.chen@email.com",
    status: "Pending",
    submittedAt: daysAgo(3),
    expirationDays: 5,
    items: [
      {
        plantName: "Snake Plant",
        price: 45,
        weightLbs: 8,
        customerNotes: "Low-light tolerant varieties only.",
        photoSeed: "snakeplant",
      },
      {
        plantName: "ZZ Plant",
        price: 55,
        weightLbs: 6,
        photoSeed: "zzplant",
      },
      {
        plantName: "Pothos",
        availability: "not_available",
        unavailableReason: "currently not in UPT prop circulation",
        customerNotes: "Trailing variety preferred. We do not have this exact plant in circulation right now.",
        photoSeed: "pothos",
      },
    ],
  },
  {
    requestNumber: "UPT-REQ-2026-000003",
    customerName: "Emily Rodriguez",
    email: "emily.r@email.com",
    status: "Pending",
    submittedAt: daysAgo(4),
    expirationDays: 3,
    items: [
      {
        plantName: "Bird of Paradise",
        price: 150,
        weightLbs: 22,
        customerNotes:
          "Please note: this exact plant has one older leaf with cosmetic damage, but the newest growth is healthy.",
        photoSeed: "birdofparadise",
      },
    ],
  },
  {
    requestNumber: "UPT-REQ-2026-000004",
    customerName: "Michael Thompson",
    email: "m.thompson@email.com",
    status: "Closed",
    submittedAt: daysAgo(21),
    expirationDays: 7,
    paidAt: daysAgo(18),
    closedAt: daysAgo(18),
    plantRevenue: 103,
    items: [
      {
        plantName: "Rubber Plant",
        price: 65,
        weightLbs: 10,
        customerNotes: "Purchased and fulfilled.",
        photoSeed: "rubberplant",
      },
      {
        plantName: "Peace Lily",
        price: 38,
        weightLbs: 5,
        photoSeed: "peacelily",
      },
    ],
    response: {
      accepted: ["Rubber Plant", "Peace Lily"],
      rejected: [],
      fedexSelected: true,
    },
  },
  {
    requestNumber: "UPT-REQ-2026-000005",
    customerName: "Lisa Park",
    email: "lisa.park@email.com",
    status: "Expired",
    submittedAt: daysAgo(24),
    expirationDays: 3,
    items: [
      {
        plantName: "Calathea",
        price: 42,
        weightLbs: 4,
        customerNotes: "Could not complete payment before the hold ended.",
        photoSeed: "calathea",
      },
      {
        plantName: "Alocasia",
        availability: "not_available",
        unavailableReason: "available in 2+ mos",
        customerNotes: "This variety will cycle back later in the season.",
        photoSeed: "alocasia",
      },
    ],
    response: {
      accepted: ["Calathea"],
      rejected: [],
      fedexSelected: true,
    },
  },
  {
    requestNumber: "UPT-REQ-2026-000006",
    customerName: "David Wilson",
    email: "d.wilson@email.com",
    status: "New",
    submittedAt: daysAgo(1),
    items: [
      {
        plantName: "Philodendron Brasil",
        customerNotes: "Hanging basket if available.",
        photoSeed: "philodendron",
      },
      {
        plantName: "Hoya",
        photoSeed: "hoya",
      },
    ],
  },
  {
    requestNumber: "UPT-REQ-2026-000007",
    customerName: "Alex Rivera",
    email: "alex.rivera@example.com",
    status: "Closed",
    submittedAt: daysAgo(40),
    expirationDays: 5,
    paidAt: daysAgo(36),
    closedAt: daysAgo(36),
    plantRevenue: 180,
    items: [
      { plantName: "Anthurium", price: 95, weightLbs: 7, photoSeed: "anthurium" },
      { plantName: "Scindapsus", price: 85, weightLbs: 4, photoSeed: "scindapsus" },
      {
        plantName: "Rare Alocasia",
        availability: "not_available",
        unavailableReason: "not in our current inventory",
        customerNotes: "Not in our current inventory.",
        photoSeed: "rare-alocasia",
      },
    ],
    response: {
      accepted: ["Anthurium", "Scindapsus"],
      rejected: [],
      fedexSelected: false,
    },
  },
  {
    requestNumber: "UPT-REQ-2026-000099",
    customerName: "Alex Rivera",
    email: "alex.rivera@example.com",
    status: "Pending",
    submittedAt: daysAgo(2),
    expirationDays: 5,
    items: [
      {
        plantName: "Thai Constellation",
        price: 175,
        weightLbs: 9.5,
        customerNotes:
          "Please note: this exact plant has a small scar on one leaf. Customer-facing disclaimer for the original offer only.",
        photoSeed: "thaiconstellation",
      },
      {
        plantName: "String of Pearls",
        availability: "not_available",
        unavailableReason: "not in our current inventory",
        customerNotes: "Not in our current inventory.",
        photoSeed: "stringofpearls",
      },
    ],
    response: {
      accepted: [],
      rejected: ["Thai Constellation"],
      fedexSelected: false,
    },
  },
];

export async function ensureShopSeeded(shop: string): Promise<void> {
  await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
      adminNotificationEmail: process.env.UPT_ADMIN_EMAIL || "",
    },
  });

  const existingNumbers = new Set(
    (
      await prisma.plantRequest.findMany({
        where: { shop },
        select: { requestNumber: true },
      })
    ).map((row) => row.requestNumber),
  );

  const year = new Date().getFullYear();
  const currentSequence = await prisma.requestNumberSequence.findUnique({
    where: { shop_year: { shop, year } },
  });
  const nextValue = Math.max(
    currentSequence?.nextValue ?? 1,
    SEED_REQUESTS.length + 1,
  );
  await prisma.requestNumberSequence.upsert({
    where: { shop_year: { shop, year } },
    update: { nextValue },
    create: { shop, year, nextValue },
  });

  for (const seed of SEED_REQUESTS) {
    if (existingNumbers.has(seed.requestNumber)) continue;
    const customer = await prisma.customerProfile.upsert({
      where: { shop_email: { shop, email: seed.email } },
      update: { name: seed.customerName },
      create: {
        shop,
        name: seed.customerName,
        email: seed.email,
      },
    });

    const hasOffer = seed.status !== "New";
    const sentAt = new Date(seed.submittedAt.getTime() + 6 * 60 * 60 * 1000);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (seed.expirationDays ?? 3));
    if (seed.status === "Expired") {
      expiresAt.setTime(Date.now() - 24 * 60 * 60 * 1000);
    }

    const created = await prisma.plantRequest.create({
      data: {
        shop,
        requestNumber: seed.requestNumber,
        customerId: customer.id,
        customerName: seed.customerName,
        customerEmail: seed.email,
        status: seed.status,
        submittedAt: seed.submittedAt,
        closedAt: seed.closedAt ?? null,
        expiredAt: seed.status === "Expired" ? expiresAt : null,
        paidAt: seed.paidAt ?? null,
        items: {
          create: seed.items.map((item) => ({
            plantName: item.plantName,
            offeredName: item.plantName,
            customerRequestNotes: item.notes ?? null,
            quantity: 1,
            availability: item.availability ?? "available",
            unavailableReason:
              item.unavailableReason ?? DEFAULT_UNAVAILABLE_REASON,
            price: item.price ?? 0,
            weightLbs: item.weightLbs ?? 0,
            customerFacingNotes: item.customerNotes ?? "",
            itemStatus:
              seed.status === "Closed" && (item.availability ?? "available") === "available"
                ? "Sold"
                : (item.availability ?? "available") === "not_available"
                  ? "Unavailable"
                  : hasOffer
                    ? "Offered"
                    : "Requested",
            purchasedAt:
              seed.paidAt && (item.availability ?? "available") === "available"
                ? seed.paidAt
                : null,
            photos: {
              create: [
                {
                  url: `https://picsum.photos/seed/${item.photoSeed ?? item.plantName}/800/800`,
                  sortOrder: 0,
                },
                {
                  url: `https://picsum.photos/seed/${item.photoSeed ?? item.plantName}-angle2/800/800`,
                  sortOrder: 1,
                },
                {
                  url: `https://picsum.photos/seed/${item.photoSeed ?? item.plantName}-angle3/800/800`,
                  sortOrder: 2,
                },
              ],
            },
          })),
        },
        statusEvents: {
          create: [
            { toStatus: "New", reason: "Customer submitted request", createdAt: seed.submittedAt },
            ...(hasOffer
              ? [
                  {
                    fromStatus: "New",
                    toStatus: "Pending",
                    reason: "Offer sent",
                    createdAt: sentAt,
                  },
                ]
              : []),
            ...(seed.status === "Closed"
              ? [
                  {
                    fromStatus: "Pending",
                    toStatus: "Closed",
                    reason: seed.paidAt ? "Payment completed" : "Manually closed",
                    createdAt: seed.closedAt ?? sentAt,
                  },
                ]
              : []),
            ...(seed.status === "Expired"
              ? [
                  {
                    fromStatus: "Pending",
                    toStatus: "Expired",
                    reason: "Offer expired before payment",
                    createdAt: expiresAt,
                  },
                ]
              : []),
          ],
        },
      },
      include: { items: { include: { photos: true } } },
    });

    if (hasOffer) {
      await prisma.offer.create({
        data: {
          requestId: created.id,
          sentAt,
          expiresAt,
          expirationDays: seed.expirationDays ?? 3,
          offerLink: `/customer/requests/${created.id}`,
          items: {
            create: created.items.map((item) => ({
              requestItemId: item.id,
              plantName: item.offeredName,
              quantity: item.quantity,
              price: item.price,
              weightLbs: item.weightLbs,
              customerFacingNotes: item.customerFacingNotes,
              availability: item.availability,
              unavailableReason: item.unavailableReason,
              photoUrlsJson: JSON.stringify(item.photos.map((photo) => photo.url)),
            })),
          },
        },
      });
    }

    if (seed.response) {
      await prisma.customerResponse.create({
        data: {
          requestId: created.id,
          customerName: seed.customerName,
          customerEmail: seed.email,
          requestNumber: seed.requestNumber,
          offerExpiresAt: expiresAt,
          fedexUpgradeSelected: seed.response.fedexSelected,
          fedexUpgradePrice: 15,
          snapshotJson: JSON.stringify(seed.response),
          respondedAt: new Date(sentAt.getTime() + 8 * 60 * 60 * 1000),
          items: {
            create: created.items.map((item) => {
              const finalChoice =
                item.availability === "not_available"
                  ? "unavailable"
                  : seed.response?.accepted.includes(item.plantName)
                    ? "accept"
                    : "reject";
              return {
                requestItemId: item.id,
                plantName: item.plantName,
                choice: finalChoice,
                price: item.price,
                quantity: 1,
                customerFacingNotes: item.customerFacingNotes,
                photoUrlsJson: JSON.stringify(item.photos.map((photo) => photo.url)),
                unavailableReason: item.unavailableReason,
              };
            }),
          },
        },
      });
    }

    if (seed.paidAt) {
      const accepted = created.items.filter((item) =>
        seed.response?.accepted.includes(item.plantName),
      );
      await prisma.draftOrderReference.create({
        data: {
          requestId: created.id,
          invoiceUrl: `/customer/requests/${created.id}`,
          paidAt: seed.paidAt,
          lineItemsJson: JSON.stringify(
            accepted.map((item) => ({
              title: item.plantName,
              quantity: 1,
              price: item.price,
              weightLbs: item.weightLbs,
              kind: "plant",
            })),
          ),
        },
      });
      await prisma.shopifyOrderReference.create({
        data: {
          requestId: created.id,
          shopifyOrderGid: `gid://shopify/Order/seed-${created.id}`,
          orderNumber: seed.requestNumber.replace("UPT-REQ-", "#"),
          paidAt: seed.paidAt,
          plantRevenue: seed.plantRevenue ?? accepted.reduce((sum, item) => sum + item.price, 0),
        },
      });
    }
  }

  await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email: "alex.rivera@example.com" } },
    update: { name: "Alex Rivera" },
    create: {
      shop,
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
    },
  });
}
