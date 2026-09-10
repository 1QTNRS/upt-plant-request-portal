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
  await prisma.plantIdentitySuggestion.deleteMany({ where: { shop } });
  await prisma.plantNameAlias.deleteMany({ where: { shop } });
  await prisma.canonicalPlant.deleteMany({ where: { shop } });
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
  choices?: Array<"accept" | "reject" | "unavailable">;
  /** What the customer typed, when it differs from `Plant 0`, `Plant 1`, … */
  requestedNames?: string[];
  /** What UPT called the plant in the offer, as renaming an exact plant does. */
  offeredNames?: string[];
  /** Defaults to a fixed date; the behaviour window needs a recent one. */
  submittedAt?: Date;
  /** How each plant was to be supplied, defaulting to the exact-plant route. */
  fulfillmentTypes?: Array<"exact_plant" | "growers_choice">;
  /** Per plant; a false marks the plant UPT could not supply at all. */
  availability?: boolean[];
  customerName?: string;
  email?: string;
}) {
  const customerName = options.customerName ?? "Test Customer";
  const email = options.email ?? "test.customer@example.com";
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email } },
    create: { shop, name: customerName, email },
    update: {},
  });

  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber: options.requestNumber,
      customerId: customer.id,
      customerName,
      customerEmail: email,
      status: options.status,
      submittedAt: options.submittedAt ?? new Date("2026-01-15T00:00:00.000Z"),
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
          availability:
            options.availability?.[index] === false ? "not_available" : "available",
          fulfillmentType: options.fulfillmentTypes?.[index] ?? "exact_plant",
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
          availability:
            options.availability?.[index] === false ? "not_available" : "available",
          fulfillmentType: options.fulfillmentTypes?.[index] ?? "exact_plant",
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
        customerName,
        customerEmail: email,
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

describe("plant tables group by canonical identity", () => {
  before(reset);
  after(reset);

  it("counts spellings of one plant as one plant", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ300",
      status: "Pending",
      prices: [100],
      requestedNames: ["Hoya carnosa"],
      submittedAt: new Date("2026-01-10T00:00:00.000Z"),
    });
    await seedRequest({
      requestNumber: "REQ301",
      status: "Pending",
      prices: [100],
      requestedNames: ["H. carnosa"],
      submittedAt: new Date("2026-01-11T00:00:00.000Z"),
    });
    await seedRequest({
      requestNumber: "REQ302",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [100],
      choices: ["accept"],
      requestedNames: ["hoya  carnosa"],
      submittedAt: new Date("2026-01-12T00:00:00.000Z"),
    });
    await seedRequest({
      requestNumber: "REQ303",
      status: "Pending",
      prices: [100],
      requestedNames: ["Hoya carnsa"],
      submittedAt: new Date("2026-01-13T00:00:00.000Z"),
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(
      analytics.plants.mostRequested.length,
      1,
      "four spellings of one plant belong on one row",
    );

    const plant = analytics.plants.mostRequested[0];
    assert.equal(plant.plantName, "Hoya carnosa");
    assert.equal(plant.requestCount, 4);
    assert.equal(plant.offeredCount, 4);
    assert.equal(plant.purchaseCount, 1);
    assert.equal(plant.revenue, 100);
    assert.equal(plant.conversionRate, 25);
    // The owner can see exactly which wordings the row is made of.
    assert.equal(plant.variants, "H. carnosa, Hoya carnosa, Hoya carnsa, hoya  carnosa");
  });

  it("keeps clones, cultivars and accessions on rows of their own", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ310",
      status: "Pending",
      prices: [100, 100, 100],
      requestedNames: [
        "Hoya carnosa",
        "Hoya carnosa 'Krimson Queen'",
        "Hoya carnosa clone 4",
      ],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.plants.mostRequested.length, 3);
    assert.deepEqual(
      analytics.plants.mostRequested.map((plant) => plant.requestCount),
      [1, 1, 1],
    );
  });

  it("gives an existing row an identity without touching the customer's text", async () => {
    await reset();
    const request = await seedRequest({
      requestNumber: "REQ320",
      status: "Pending",
      prices: [100],
      requestedNames: ["  HOYA   carnosa "],
    });

    await getAnalytics(shop, range);
    const item = await prisma.requestItem.findFirstOrThrow({
      where: { requestId: request.id },
      include: { canonicalPlant: true },
    });
    assert.equal(item.plantName, "  HOYA   carnosa ");
    assert.equal(item.canonicalPlant?.displayName, "HOYA carnosa");
  });

  it("flags a repeated request and decline of one plant", async () => {
    await reset();
    const recent = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000);

    for (const [index, name] of ["Hoya carnosa", "H. carnosa", "hoya  carnosa"].entries()) {
      await seedRequest({
        requestNumber: `REQ33${index}`,
        status: "Pending",
        prices: [100],
        choices: ["reject"],
        requestedNames: [name],
        submittedAt: recent(30 - index * 5),
      });
    }

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.customerSummary.repeatedRequestDeclineCustomers, 1);
    const customer = analytics.customers[0];
    assert.equal(customer.behaviorFlag, "Repeated Request / Decline Pattern");
    assert.equal(customer.plantPatterns.length, 1);
    assert.equal(customer.plantPatterns[0].plantName, "Hoya carnosa");
    assert.equal(customer.plantPatterns[0].timesDeclined, 3);
  });

  it("does not flag three genuinely different plants", async () => {
    await reset();
    const recent = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000);

    for (const [index, name] of [
      "Hoya carnosa",
      "Hoya lacunosa",
      "Monstera deliciosa",
    ].entries()) {
      await seedRequest({
        requestNumber: `REQ34${index}`,
        status: "Pending",
        prices: [100],
        choices: ["reject"],
        requestedNames: [name],
        submittedAt: recent(30 - index * 5),
      });
    }

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.customerSummary.repeatedRequestDeclineCustomers, 0);
    assert.equal(analytics.customers[0].plantPatterns.length, 0);
  });
});

describe("analytics by fulfilment source", () => {
  before(reset);
  after(reset);

  it("keeps the two routes and Not Available apart", async () => {
    await reset();
    await seedRequest({
      requestNumber: "REQ400",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [285, 250, 0],
      choices: ["accept", "accept", "unavailable"],
      fulfillmentTypes: ["growers_choice", "exact_plant", "growers_choice"],
      availability: [true, true, false],
    });

    const { fulfillment } = await getAnalytics(shop, range);
    assert.deepEqual(fulfillment.growersChoice, {
      lines: 1,
      offered: 1,
      accepted: 1,
      rejected: 0,
      purchased: 1,
      revenue: 285,
    });
    assert.deepEqual(fulfillment.exactPlant, {
      lines: 1,
      offered: 1,
      accepted: 1,
      rejected: 0,
      purchased: 1,
      revenue: 250,
    });
    // A plant UPT could not supply at all sits on its own route however it was
    // going to have been supplied, because nothing was ever offered.
    assert.deepEqual(fulfillment.notAvailable, {
      lines: 1,
      offered: 0,
      accepted: 0,
      rejected: 0,
      purchased: 0,
      revenue: 0,
    });
    assert.equal(fulfillment.requestsFulfilledFromExistingStock, 1);
  });

  it("compares the two routes on offered-to-paid", async () => {
    await reset();
    // One of two off-the-shelf plants is paid for; neither exact plant is.
    await seedRequest({
      requestNumber: "REQ401",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [285, 250],
      choices: ["accept", "accept"],
      fulfillmentTypes: ["growers_choice", "exact_plant"],
    });
    await seedRequest({
      requestNumber: "REQ402",
      status: "Expired",
      prices: [100, 200],
      choices: ["reject", "accept"],
      fulfillmentTypes: ["growers_choice", "exact_plant"],
    });

    const { fulfillment } = await getAnalytics(shop, range);
    assert.equal(fulfillment.existingStockAcceptanceRate, 50);
    assert.equal(fulfillment.existingStockPurchaseRate, 100);
    assert.equal(fulfillment.existingStockConversionRate, 50);
    assert.equal(fulfillment.exactPlantConversionRate, 50);
    assert.equal(
      fulfillment.requestsFulfilledFromExistingStock,
      1,
      "counted per request, not per plant",
    );
  });

  it("still groups plant demand by identity, not by fulfilment route", async () => {
    await reset();
    // The same plant, once sourced as an exact plant and once sold off the
    // shelf under the product's own formatting. That is one plant to demand.
    await seedRequest({
      requestNumber: "REQ403",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [285],
      choices: ["accept"],
      requestedNames: ["Monstera Thai Constellation"],
      offeredNames: ["Monstera Thai Constellation"],
      fulfillmentTypes: ["growers_choice"],
    });
    await seedRequest({
      requestNumber: "REQ404",
      status: "Expired",
      prices: [300],
      choices: ["reject"],
      requestedNames: ["monstera  thai constellation"],
      offeredNames: ["Monstera Thai Constellation Exact"],
      fulfillmentTypes: ["exact_plant"],
    });

    const analytics = await getAnalytics(shop, range);
    assert.equal(analytics.plants.mostRequested.length, 1);
    assert.equal(analytics.plants.mostRequested[0].requestCount, 2);
    assert.equal(analytics.fulfillment.growersChoice.lines, 1);
    assert.equal(analytics.fulfillment.exactPlant.lines, 1);
  });

  it("never counts the FedEx upgrade as a plant on either route", async () => {
    await reset();
    const request = await seedRequest({
      requestNumber: "REQ405",
      status: "Closed",
      paidAt: new Date("2026-01-20T00:00:00.000Z"),
      prices: [285],
      choices: ["accept"],
      fulfillmentTypes: ["growers_choice"],
    });
    await prisma.customerResponse.update({
      where: { requestId: request.id },
      data: { fedexUpgradeSelected: true, fedexUpgradePrice: 15 },
    });

    const { fulfillment } = await getAnalytics(shop, range);
    const lines =
      fulfillment.exactPlant.lines +
      fulfillment.growersChoice.lines +
      fulfillment.notAvailable.lines;
    assert.equal(lines, 1, "the shipping upgrade is not a plant");
    assert.equal(fulfillment.growersChoice.revenue, 285);
  });
});

describe("analytics date range", () => {
  before(reset);
  after(reset);

  /**
   * One paid request inside the picker, one paid request outside it — the
   * customer table, item-conversion rows, and this/last-month cards used to
   * read the whole shop and ignore `range`.
   */
  it("keeps the customer table, item conversion and month cards on the picker", async () => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10);
    const lastMonthPaid = lastMonthStart;

    await seedRequest({
      requestNumber: "REQ500",
      status: "Closed",
      customerName: "In Range",
      email: "in.range@example.com",
      prices: [200],
      choices: ["accept"],
      submittedAt: now,
      paidAt: now,
    });
    await seedRequest({
      requestNumber: "REQ501",
      status: "Closed",
      customerName: "Paid This Month Outside Range",
      email: "outside.thismonth@example.com",
      prices: [500],
      choices: ["accept"],
      submittedAt: twoMonthsAgo,
      paidAt: now,
    });
    await seedRequest({
      requestNumber: "REQ502",
      status: "Closed",
      customerName: "Last Month Only",
      email: "last.month@example.com",
      prices: [300],
      choices: ["accept"],
      submittedAt: lastMonthStart,
      paidAt: lastMonthPaid,
    });

    const thisMonth = await getAnalytics(shop, {
      start: thisMonthStart,
      end: now,
    });
    assert.deepEqual(
      thisMonth.customers.map((row) => row.email).sort(),
      ["in.range@example.com"],
      "a customer whose only request sits outside the picker is not listed",
    );
    assert.deepEqual(
      thisMonth.itemPurchaseRows.map((row) => row.requestId).sort(),
      ["REQ500"],
      "item conversion lists only requests submitted in the range",
    );
    assert.equal(
      thisMonth.financial.revenueThisMonth,
      200,
      "a payment this month on an older request does not fill Revenue This Month",
    );
    assert.equal(
      thisMonth.financial.revenueLastMonth,
      0,
      "last month's paid request is outside This Month's submittedAt window",
    );
    assert.deepEqual(thisMonth.financial.revenueByMonth, [
      { month: monthKey(now), revenue: 200 },
    ]);

    const lastMonthEnd = thisMonthStart;
    const lastMonth = await getAnalytics(shop, {
      start: lastMonthStart,
      end: new Date(lastMonthEnd.getTime() - 1),
    });
    assert.deepEqual(
      lastMonth.customers.map((row) => row.email),
      ["last.month@example.com"],
    );
    assert.equal(lastMonth.financial.revenueThisMonth, 0);
    assert.equal(lastMonth.financial.revenueLastMonth, 300);

    const allTime = await getAnalytics(shop, range);
    assert.equal(allTime.customers.length, 3);
    assert.equal(allTime.itemPurchaseRows.length, 3);
    assert.equal(allTime.financial.revenueThisMonth, 700);
    assert.equal(allTime.financial.revenueLastMonth, 300);
  });

  it("counts only the in-range requests on a customer who also has older ones", async () => {
    await reset();
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    await seedRequest({
      requestNumber: "REQ510",
      status: "Closed",
      customerName: "Alex Rivera",
      email: "alex.range@example.com",
      prices: [180],
      choices: ["accept"],
      submittedAt: new Date(now.getFullYear(), now.getMonth() - 2, 4),
      paidAt: new Date(now.getFullYear(), now.getMonth() - 2, 8),
    });
    await seedRequest({
      requestNumber: "REQ511",
      status: "Pending",
      customerName: "Alex Rivera",
      email: "alex.range@example.com",
      prices: [175],
      submittedAt: now,
    });

    const thisMonth = await getAnalytics(shop, {
      start: thisMonthStart,
      end: now,
    });
    assert.equal(thisMonth.customers.length, 1);
    assert.equal(thisMonth.customers[0].totalRequests, 1);
    assert.equal(thisMonth.customers[0].itemsPurchased, 0);
    assert.equal(thisMonth.customers[0].totalRevenue, 0);
    assert.deepEqual(
      thisMonth.itemPurchaseRows.map((row) => row.requestId),
      ["REQ511"],
    );
  });
});

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
