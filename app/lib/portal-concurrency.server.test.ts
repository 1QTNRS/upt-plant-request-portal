import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { expireOverdueOffers, markRequestPaid } from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-concurrency-test`;

async function reset() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

/** A Pending request whose hold ran out an hour ago. */
async function seedOverdueRequest(requestNumber: string) {
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email: "race@example.com" } },
    create: { shop, name: "Race Customer", email: "race@example.com" },
    update: {},
  });

  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: "Race Customer",
      customerEmail: "race@example.com",
      status: "Pending",
      items: {
        create: [{ plantName: "Monstera", offeredName: "Monstera", price: 100 }],
      },
    },
  });

  await prisma.offer.create({
    data: {
      requestId: request.id,
      expirationDays: 3,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      offerLink: `https://${shop}/apps/plant-requests/requests/${request.id}`,
    },
  });

  return request;
}

const statusEvents = (requestId: string, reason: string) =>
  prisma.statusEvent.count({ where: { requestId, reason } });

describe("concurrent expiry sweeps", () => {
  before(reset);
  after(reset);

  it("writes one expiry event however many sweeps run at once", async () => {
    const request = await seedOverdueRequest("REQ200");

    // Every request loader, list and the hourly cron run this, so overlapping
    // sweeps are the normal case rather than an edge case.
    const counts = await Promise.all([
      expireOverdueOffers(shop),
      expireOverdueOffers(shop),
      expireOverdueOffers(shop),
    ]);

    assert.equal(
      counts.reduce((sum, n) => sum + n, 0),
      1,
      "exactly one sweep may claim the request",
    );
    assert.equal(await statusEvents(request.id, "Offer expired before payment"), 1);

    const after = await prisma.plantRequest.findUnique({ where: { id: request.id } });
    assert.equal(after?.status, "Expired");
  });

  it("does not re-expire a request that is already Expired", async () => {
    const request = await seedOverdueRequest("REQ201");
    await expireOverdueOffers(shop);
    const expiredAt = (await prisma.plantRequest.findUnique({ where: { id: request.id } }))
      ?.expiredAt;

    assert.equal(await expireOverdueOffers(shop), 0);
    const again = await prisma.plantRequest.findUnique({ where: { id: request.id } });
    assert.deepEqual(again?.expiredAt, expiredAt, "expiredAt is not overwritten");
    assert.equal(await statusEvents(request.id, "Offer expired before payment"), 1);
  });
});

describe("redelivered payment webhooks", () => {
  before(reset);
  after(reset);

  it("writes one payment event when the same order arrives twice at once", async () => {
    const request = await seedOverdueRequest("REQ202");
    await prisma.plantRequest.update({
      where: { id: request.id },
      data: { status: "Pending" },
    });
    await prisma.offer.update({
      where: { requestId: request.id },
      data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const order = {
      shopifyOrderGid: "gid://shopify/Order/12345",
      orderNumber: "#1001",
      plantRevenue: 100,
    };
    await Promise.all([
      markRequestPaid(shop, request.id, order),
      markRequestPaid(shop, request.id, order),
    ]);

    assert.equal(await statusEvents(request.id, "Payment completed"), 1);
    assert.equal(
      await prisma.shopifyOrderReference.count({ where: { requestId: request.id } }),
      1,
    );
    const paid = await prisma.plantRequest.findUnique({ where: { id: request.id } });
    assert.equal(paid?.status, "Closed");
    assert.ok(paid?.paidAt);
  });
});
