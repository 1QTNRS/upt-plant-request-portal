import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { getAnalytics } from "./analytics.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-analytics-test`;

const range = {
  start: new Date("2020-01-01T00:00:00.000Z"),
  end: new Date("2999-01-01T00:00:00.000Z"),
};

async function reset() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

/**
 * One request, offered two available plants, with the customer's answers and
 * whether it was ever paid left to the caller — which is the whole of what the
 * revenue figures are supposed to distinguish.
 */
async function seedRequest(options: {
  requestNumber: string;
  status: string;
  paidAt?: Date | null;
  prices: number[];
  choices?: Array<"accept" | "reject">;
  /** What the customer typed, when it differs from `Plant 0`, `Plant 1`, … */
  requestedNames?: string[];
  /** What UPT called the plant in the offer, as renaming an exact plant does. */
  offeredNames?: string[];
}) {
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email: "test.customer@example.com" } },
    create: { shop, name: "Test Customer", email: "test.customer@example.com" },
    update: {},
  });

  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber: options.requestNumber,
      customerId: customer.id,
      customerName: "Test Customer",
      customerEmail: "test.customer@example.com",
      status: options.status,
      submittedAt: new Date("2026-01-15T00:00:00.000Z"),
      paidAt: options.paidAt ?? null,
      items: {
        create: options.prices.map((price, index) => ({
          plantName: options.requestedNames?.[index] ?? `Plant ${index}`,
          offeredName:
            options.offeredNames?.[index] ??
            options.requestedNames?.[index] ??
            `Plant ${index}`,
          quantity: 1,
          price,
          availability: "available",
          itemStatus: "Offered",
        })),
      },
    },
    include: { items: true },
  });

  await prisma.offer.create({
    data: {
      requestId: request.id,
      expirationDays: 3,
      sentAt: new Date("2026-01-16T00:00:00.000Z"),
      expiresAt: new Date("2026-01-19T00:00:00.000Z"),
      offerLink: `https://${shop}/apps/plant-requests/requests/${request.id}`,
      items: {
        create: request.items.map((item, index) => ({
          requestItemId: item.id,
          plantName: item.offeredName || item.plantName,
          quantity: 1,
          price: options.prices[index],
          weightLbs: 1,
          customerFacingNotes: "",
          availability: "available",
        })),
      },
    },
  });

  // Revenue is read from the recorded order, which only exists once paid.
  if (options.paidAt) {
    await prisma.shopifyOrderReference.create({
      data: {
        requestId: request.id,
        shopifyOrderGid: `gid://shopify/Order/${options.requestNumber}`,
        orderNumber: options.requestNumber,
        paidAt: options.paidAt,
        plantRevenue: options.prices.reduce((sum, price) => sum + price, 0),
      },
    });
  }

  if (options.choices) {
    await prisma.customerResponse.create({
      data: {
        requestId: request.id,
        respondedAt: new Date("2026-01-17T00:00:00.000Z"),
        customerName: "Test Customer",
        customerEmail: "test.customer@example.com",
        requestNumber: options.requestNumber,
        fedexUpgradeSelected: false,
        snapshotJson: "{}",
        items: {
          create: request.items.map((item, index) => ({
            requestItemId: item.id,
            plantName: item.offeredName || item.plantName,
            choice: options.choices![index],
            price: options.prices[index],
            quantity: 1,
          })),
        },
      },
    });
  }

  return request;
}

describe("analytics revenue", () => {
  before(reset);
  after(reset);

  it("does not count a Closed request that was never paid", async () => {
    await seedRequest({
      requestNumber: "REQ100",
      status: "Closed",
      paidAt: null,
      prices: [1200],
      choices: ["accept"],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(
      analytics.financial.revenueFromClosedRequests,
      0,
      "a request closed without payment is not revenue",
    );
    assert.equal(analytics.financial.revenueThisMonth, 0);
  });

  it("counts a Closed request that was paid", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ101",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [1200],
      choices: ["accept"],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.financial.revenueFromClosedRequests, 1200);
  });

  it("excludes plants the customer rejected from revenue lost to expiry", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ102",
      status: "Expired",
      prices: [500, 300],
      choices: ["reject", "accept"],
    });

    const analytics = await getAnalytics(shop, range);
    // Only the accepted-but-unpaid plant was ever at risk of being lost to the
    // deadline; the rejected one is already counted as customerDeclined.
    assert.equal(analytics.financial.revenueLostToExpiredRequests, 300);
    assert.equal(analytics.releasedItems.customerDeclined, 1);
  });

  it("counts an expired offer nobody answered in full", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ103",
      status: "Expired",
      prices: [500, 300],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.financial.revenueLostToExpiredRequests, 800);
  });
});

describe("most requested plants", () => {
  before(reset);
  after(reset);

  it("keeps a renamed plant on one row and converts against its requests", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ200",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [200],
      choices: ["accept"],
      requestedNames: ["Paid Flow Plant"],
      offeredNames: ["Paid Exact Alocasia"],
    });

    const analytics = await getAnalytics(shop, range);
    // Giving an exact plant its own offered name used to split it into a row
    // holding the request and a row holding the purchase, both at 0%.
    assert.equal(analytics.plants.mostRequested.length, 1);
    const plant = analytics.plants.mostRequested[0];
    assert.equal(plant.plantName, "Paid Flow Plant");
    assert.equal(plant.offeredName, "Paid Exact Alocasia");
    assert.equal(plant.requestCount, 1);
    assert.equal(plant.offeredCount, 1);
    assert.equal(plant.acceptedCount, 1);
    assert.equal(plant.purchaseCount, 1);
    assert.equal(plant.revenue, 200);
    assert.equal(plant.conversionRate, 100);
  });

  it("adds up several requests for the same plant under different offered names", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ201",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [300],
      choices: ["accept"],
      requestedNames: ["Monstera Albo"],
      offeredNames: ["Monstera Albo Exact A"],
    });
    await seedRequest({
      requestNumber: "REQ202",
      status: "Expired",
      prices: [400],
      choices: ["reject"],
      requestedNames: ["Monstera Albo"],
      offeredNames: ["Monstera Albo Exact B"],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.plants.mostRequested.length, 1);
    const plant = analytics.plants.mostRequested[0];
    assert.equal(plant.plantName, "Monstera Albo");
    assert.equal(
      plant.offeredName,
      "Monstera Albo Exact A, Monstera Albo Exact B",
      "the offered names belong in a column, not in rows of their own",
    );
    assert.equal(plant.requestCount, 2);
    assert.equal(plant.offeredCount, 2);
    assert.equal(plant.purchaseCount, 1);
    assert.equal(plant.conversionRate, 50);
  });

  it("leaves the offered name blank when UPT did not rename the plant", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ203",
      status: "Pending",
      prices: [120],
      requestedNames: ["Hoya Callistophylla"],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.plants.mostRequested[0]?.offeredName, "");
  });
});
