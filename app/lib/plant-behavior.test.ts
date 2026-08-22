import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { disabledPlantIdentityProvider } from "./plant-identity-ai.server";
import { backfillCanonicalPlants } from "./plant-identity.server";
import {
  describeRepeatedRequestDecline,
  REPEATED_DECLINE_MIN_DECLINES,
  REPEATED_DECLINE_MIN_REQUESTS,
  REPEATED_DECLINE_WINDOW_DAYS,
  repeatedRequestDeclinePattern,
  type CanonicalPlantActivity,
} from "./plant-behavior";
import { customerPlantPatterns, requestPlantPatterns } from "./plant-behavior.server";
import { behaviorFlagTone, computeBehaviorFlags, primaryBehaviorFlag } from "./portal";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-plant-behavior-test`;
const email = "behavior@example.com";

function activity(
  overrides: Partial<CanonicalPlantActivity> = {},
): CanonicalPlantActivity {
  return {
    canonicalPlantId: "plant-1",
    displayName: "Hoya xyz",
    requestedNames: ["Hoya XYZ"],
    timesRequested: 4,
    timesOffered: 4,
    timesDeclined: 4,
    timesPurchased: 0,
    timesExpired: 0,
    rangeDays: 60,
    mostRecentRequestAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("repeated request / decline pattern", () => {
  it("fires on the owner's example", () => {
    const pattern = repeatedRequestDeclinePattern(activity());
    assert.ok(pattern);
    assert.equal(pattern.flag, "Repeated Request / Decline Pattern");
    assert.equal(
      pattern.summary,
      "This customer requested Hoya xyz 4 times in the last 90 days and declined all 4 offers. They have never bought it.",
    );
  });

  it("needs three requests", () => {
    assert.equal(
      repeatedRequestDeclinePattern(
        activity({ timesRequested: REPEATED_DECLINE_MIN_REQUESTS - 1, timesOffered: 2, timesDeclined: 2 }),
      ),
      null,
    );
    assert.ok(
      repeatedRequestDeclinePattern(
        activity({ timesRequested: REPEATED_DECLINE_MIN_REQUESTS, timesOffered: 3, timesDeclined: 2 }),
      ),
    );
  });

  it("needs two outright declines, not one plus silence", () => {
    assert.equal(
      repeatedRequestDeclinePattern(
        activity({
          timesDeclined: REPEATED_DECLINE_MIN_DECLINES - 1,
          timesExpired: 3,
        }),
      ),
      null,
    );
  });

  it("does not fire once the customer has bought the plant", () => {
    assert.equal(
      repeatedRequestDeclinePattern(activity({ timesPurchased: 1 })),
      null,
    );
  });

  it("counts partial declines honestly", () => {
    const summary = describeRepeatedRequestDecline(
      activity({ timesRequested: 5, timesOffered: 4, timesDeclined: 2, timesExpired: 2 }),
    );
    assert.ok(summary.includes("declined 2 of 4 offers"));
    assert.ok(summary.includes("2 further offers expired unanswered"));
  });

  it("is an internal flag with a tone and a priority", () => {
    const flags = computeBehaviorFlags({
      totalRequests: 4,
      offersSent: 4,
      itemsRequested: 4,
      itemsOffered: 4,
      itemsAccepted: 0,
      itemsPurchased: 0,
      closedPaidRequests: 0,
      expiredRequests: 0,
      totalRevenue: 0,
      repeatedRequestDeclinePlants: 1,
    });
    assert.ok(flags.includes("Repeated Request / Decline Pattern"));
    assert.equal(
      primaryBehaviorFlag(flags),
      "Repeated Request / Decline Pattern",
      "the most specific thing known about a customer leads",
    );
    assert.equal(behaviorFlagTone("Repeated Request / Decline Pattern"), "warning");
  });

  it("is absent without the plant-level count", () => {
    const flags = computeBehaviorFlags({
      totalRequests: 4,
      offersSent: 4,
      itemsRequested: 4,
      itemsOffered: 4,
      itemsAccepted: 0,
      itemsPurchased: 0,
      closedPaidRequests: 0,
      expiredRequests: 0,
      totalRevenue: 0,
    });
    assert.ok(!flags.includes("Repeated Request / Decline Pattern"));
  });
});

/**
 * The flag is admin-only. A customer must never see that the shop has noticed a
 * pattern in their behaviour, so nothing they can load may reach this module or
 * name the flag.
 */
describe("the pattern never reaches a customer", () => {
  const roots = [
    path.join(import.meta.dirname, "..", "routes"),
    path.join(import.meta.dirname, "..", "components"),
  ];

  it("is not referenced by any customer route or component", async () => {
    const forbidden = [
      "plant-behavior",
      "Repeated Request / Decline Pattern",
      "behaviorFlag",
      "plantPatterns",
    ];

    let checked = 0;
    for (const root of roots) {
      const entries = await readdir(root).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!/^customer[.-]/.test(entry)) continue;
        const source = await readFile(path.join(root, entry), "utf8");
        checked += 1;
        for (const needle of forbidden) {
          assert.ok(
            !source.includes(needle),
            `${entry} must not reference ${needle}`,
          );
        }
      }
    }
    assert.ok(checked > 0, "the customer-facing files should have been found");
  });
});

let nextRequestNumber = 1;

async function reset() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.plantIdentitySuggestion.deleteMany({ where: { shop } });
  await prisma.plantNameAlias.deleteMany({ where: { shop } });
  await prisma.canonicalPlant.deleteMany({ where: { shop } });
}

/** One request for one plant, offered, with the customer's answer up to caller. */
async function seedRequest(options: {
  plantName: string;
  submittedAt: Date;
  choice?: "accept" | "reject";
  paidAt?: Date;
  status?: string;
}) {
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email } },
    create: { shop, name: "Behavior Customer", email },
    update: {},
  });

  const requestNumber = `REQ${nextRequestNumber++}`;
  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: email,
      status: options.status ?? (options.paidAt ? "Closed" : "Pending"),
      submittedAt: options.submittedAt,
      paidAt: options.paidAt ?? null,
      items: {
        create: [
          {
            plantName: options.plantName,
            offeredName: options.plantName,
            quantity: 1,
            price: 100,
            availability: "available",
            itemStatus: "Offered",
          },
        ],
      },
    },
    include: { items: true },
  });

  await prisma.offer.create({
    data: {
      requestId: request.id,
      expirationDays: 3,
      sentAt: options.submittedAt,
      expiresAt: new Date(options.submittedAt.getTime() + 86_400_000),
      offerLink: `https://${shop}/apps/plant-requests/requests/${request.id}`,
      items: {
        create: request.items.map((item) => ({
          requestItemId: item.id,
          plantName: item.plantName,
          quantity: 1,
          price: 100,
          weightLbs: 1,
          customerFacingNotes: "",
          availability: "available",
        })),
      },
    },
  });

  if (options.choice) {
    await prisma.customerResponse.create({
      data: {
        requestId: request.id,
        respondedAt: options.submittedAt,
        customerName: customer.name,
        customerEmail: email,
        requestNumber,
        fedexUpgradeSelected: false,
        snapshotJson: "{}",
        items: {
          create: request.items.map((item) => ({
            requestItemId: item.id,
            plantName: item.plantName,
            choice: options.choice!,
            price: 100,
            quantity: 1,
          })),
        },
      },
    });
  }

  return request;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

describe("behaviour patterns are counted by identity, not raw text", () => {
  const now = new Date("2026-03-01T00:00:00.000Z");

  before(reset);
  after(reset);

  it("fires when one plant is asked for under four spellings and declined", async () => {
    await reset();
    // Four spellings of one plant. On raw text this reads as four different
    // plants asked for once each, and no pattern at all.
    for (const [index, plantName] of [
      "Hoya carnosa",
      "H. carnosa",
      "hoya  carnosa",
      "Hoya carnsa",
    ].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, 70 - index * 10),
        choice: "reject",
      });
    }
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    const rows = await customerPlantPatterns(shop, { now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, email);
    assert.equal(rows[0].patterns.length, 1);

    const pattern = rows[0].patterns[0];
    assert.equal(pattern.activity.timesRequested, 4);
    assert.equal(pattern.activity.timesOffered, 4);
    assert.equal(pattern.activity.timesDeclined, 4);
    assert.equal(pattern.activity.timesPurchased, 0);
    assert.equal(pattern.activity.rangeDays, 30);
    assert.deepEqual(pattern.activity.requestedNames, [
      "H. carnosa",
      "Hoya carnosa",
      "Hoya carnsa",
      "hoya  carnosa",
    ]);
    assert.ok(pattern.summary.includes("declined all 4 offers"));
  });

  it("does not fire on four genuinely different plants", async () => {
    await reset();
    for (const [index, plantName] of [
      "Hoya carnosa",
      "Hoya lacunosa",
      "Monstera deliciosa",
      "Anthurium warocqueanum",
    ].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, 70 - index * 10),
        choice: "reject",
      });
    }
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    assert.deepEqual(await customerPlantPatterns(shop, { now }), []);
  });

  it("does not fire on plants distinguished by a clone number", async () => {
    await reset();
    for (const [index, plantName] of [
      "Hoya carnosa clone 1",
      "Hoya carnosa clone 2",
      "Hoya carnosa clone 3",
    ].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, 70 - index * 10),
        choice: "reject",
      });
    }
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    assert.deepEqual(
      await customerPlantPatterns(shop, { now }),
      [],
      "three specific clones are three plants, not one asked for three times",
    );
  });

  it("ignores requests older than the window", async () => {
    await reset();
    for (const [index, plantName] of ["Hoya carnosa", "H. carnosa", "hoya carnosa"].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, REPEATED_DECLINE_WINDOW_DAYS + 10 + index),
        choice: "reject",
      });
    }
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    assert.deepEqual(await customerPlantPatterns(shop, { now }), []);
  });

  it("stops firing once the customer buys the plant", async () => {
    await reset();
    await seedRequest({ plantName: "Hoya carnosa", submittedAt: daysAgo(now, 70), choice: "reject" });
    await seedRequest({ plantName: "H. carnosa", submittedAt: daysAgo(now, 60), choice: "reject" });
    await seedRequest({
      plantName: "hoya carnosa",
      submittedAt: daysAgo(now, 50),
      choice: "accept",
      paidAt: daysAgo(now, 49),
    });
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    assert.deepEqual(await customerPlantPatterns(shop, { now }), []);
  });

  it("surfaces only the patterns relevant to one request", async () => {
    await reset();
    for (const [index, plantName] of ["Hoya carnosa", "H. carnosa", "hoya  carnosa"].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, 70 - index * 10),
        choice: "reject",
      });
    }
    const unrelated = await seedRequest({
      plantName: "Monstera deliciosa",
      submittedAt: daysAgo(now, 5),
    });
    const relevant = await seedRequest({
      plantName: "Hoya carnosa",
      submittedAt: daysAgo(now, 2),
    });
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    assert.deepEqual(await requestPlantPatterns(shop, unrelated.id, { now }), []);
    const patterns = await requestPlantPatterns(shop, relevant.id, { now });
    assert.equal(patterns.length, 1);
    assert.ok(patterns[0].summary.includes("Hoya carnosa"));
  });

  it("does not count another customer's history against this one", async () => {
    await reset();
    for (const [index, plantName] of ["Hoya carnosa", "H. carnosa", "hoya  carnosa"].entries()) {
      await seedRequest({
        plantName,
        submittedAt: daysAgo(now, 70 - index * 10),
        choice: "reject",
      });
    }

    const other = await prisma.customerProfile.create({
      data: { shop, name: "Other Customer", email: "other@example.com" },
    });
    const otherRequest = await prisma.plantRequest.create({
      data: {
        shop,
        requestNumber: `REQ${nextRequestNumber++}`,
        customerId: other.id,
        customerName: other.name,
        customerEmail: other.email,
        status: "New",
        submittedAt: daysAgo(now, 1),
        items: {
          create: [{ plantName: "Hoya carnosa", offeredName: "Hoya carnosa", quantity: 1 }],
        },
      },
    });
    await backfillCanonicalPlants(shop, { provider: disabledPlantIdentityProvider });

    const rows = await customerPlantPatterns(shop, { now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, email);
    assert.deepEqual(await requestPlantPatterns(shop, otherRequest.id, { now }), []);
  });
});
