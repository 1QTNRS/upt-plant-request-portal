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
          plantName: `Plant ${index}`,
          offeredName: `Plant ${index}`,
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
          plantName: item.plantName,
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
            plantName: item.plantName,
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
