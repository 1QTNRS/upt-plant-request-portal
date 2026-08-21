import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import prisma from "../db.server";
import { notifyNewRequest } from "./emails.server";
import { handleCustomerRedact, handleShopRedact } from "./compliance.server";
import {
  closeRequest,
  listCustomerRequests,
  markRequestPaid,
  OfferAlreadyAnsweredError,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { ensureShopSeeded, ensureShopSettings } from "./seed-demo.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-safety-test`;
// Not a demo shop, so demo seeding and Shopify stubbing must both be refused.
const merchantShop = "unsolicited-plant-talks.myshopify.com";

async function wipe(target: string) {
  await prisma.emailMessage.deleteMany({ where: { shop: target } });
  await prisma.exactPlantListing.deleteMany({ where: { shop: target } });
  await prisma.plantRequest.deleteMany({ where: { shop: target } });
  await prisma.customerProfile.deleteMany({ where: { shop: target } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop: target } });
  await prisma.shopSettings.deleteMany({ where: { shop: target } });
}

async function offeredRequest(options?: {
  email?: string;
  shopifyCustomerId?: string;
}) {
  const created = await submitCustomerRequest(shop, {
    name: "Test Buyer",
    email: options?.email ?? "buyer@example.com",
    shopifyCustomerId: options?.shopifyCustomerId,
    items: [{ plantName: "Philodendron Spiritus Sancti" }],
  });

  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: created.items[0].id,
    availability: "available",
    price: 250,
    weightLbs: 4,
    customerFacingNotes: "Two established leaves.",
  });
  await sendOffer(shop, created.id, 3);
  return created;
}

function acceptPayload(requestId: string, itemId: string) {
  return {
    requestId,
    fedexUpgradeSelected: true,
    fedexUpgradePrice: 15,
    items: [
      {
        offerItemId: "offer-1",
        sourceItemId: itemId,
        plantName: "Philodendron Spiritus Sancti",
        choice: "accept" as const,
        price: 250,
        quantity: 1,
        lineRevenue: 250,
        customerNotes: "Two established leaves.",
        photoUrls: [],
      },
    ],
  };
}

describe("demo data is confined to demo shops", () => {
  before(async () => {
    await wipe(merchantShop);
  });

  after(async () => {
    await wipe(merchantShop);
  });

  it("creates settings but no sample requests for a merchant shop", async () => {
    await ensureShopSeeded(merchantShop);

    const settings = await prisma.shopSettings.findUnique({
      where: { shop: merchantShop },
    });
    assert.ok(settings, "a merchant shop still needs its settings row");

    const requests = await prisma.plantRequest.count({
      where: { shop: merchantShop },
    });
    assert.equal(requests, 0, "sample requests must never reach a merchant shop");

    const profiles = await prisma.customerProfile.count({
      where: { shop: merchantShop },
    });
    assert.equal(profiles, 0, "the demo customer must never reach a merchant shop");
  });

  it("still seeds sample requests for the demo shop", async () => {
    await wipe(shop);
    await ensureShopSeeded(shop);
    const requests = await prisma.plantRequest.count({ where: { shop } });
    assert.ok(requests > 0);
    await wipe(shop);
  });
});

describe("offer responses are answered once", () => {
  before(async () => {
    await wipe(shop);
    await ensureShopSettings(shop);
  });

  after(async () => {
    await wipe(shop);
  });

  it("rejects a second response for the same offer", async () => {
    const created = await offeredRequest();

    const first = await saveCustomerResponse(
      shop,
      acceptPayload(created.id, created.items[0].id),
    );
    assert.equal(first.items[0].choice, "accept");

    const second = await saveCustomerResponse(
      shop,
      acceptPayload(created.id, created.items[0].id),
    ).catch((error: Error) => error);

    assert.ok(
      second instanceof OfferAlreadyAnsweredError,
      "a repeat submit must not overwrite the recorded answer",
    );
  });
});

describe("status transitions are idempotent", () => {
  before(async () => {
    await wipe(shop);
    await ensureShopSettings(shop);
  });

  after(async () => {
    await wipe(shop);
  });

  it("does not append a second event when closing an already closed request", async () => {
    const created = await offeredRequest();
    await closeRequest(shop, created.id, "Customer closed request");
    await closeRequest(shop, created.id, "Customer closed request");

    const events = await prisma.statusEvent.count({
      where: { requestId: created.id, toStatus: "Closed" },
    });
    assert.equal(events, 1);
  });

  it("ignores a redelivered orders/paid webhook for the same order", async () => {
    const created = await offeredRequest();
    await saveCustomerResponse(shop, acceptPayload(created.id, created.items[0].id));

    const order = {
      shopifyOrderGid: "gid://shopify/Order/9001",
      orderNumber: "#9001",
      plantRevenue: 250,
    };
    await markRequestPaid(shop, created.id, order);
    const afterFirst = await prisma.plantRequest.findUnique({
      where: { id: created.id },
    });

    await markRequestPaid(shop, created.id, order);
    const afterSecond = await prisma.plantRequest.findUnique({
      where: { id: created.id },
    });

    const events = await prisma.statusEvent.count({
      where: { requestId: created.id, reason: "Payment completed" },
    });
    assert.equal(events, 1, "redelivery must not append a second paid event");
    assert.equal(
      afterSecond?.paidAt?.toISOString(),
      afterFirst?.paidAt?.toISOString(),
      "redelivery must not move the payment timestamp",
    );

    const items = await prisma.requestItem.findMany({
      where: { requestId: created.id },
    });
    assert.ok(items.every((item) => item.itemStatus === "Sold"));
  });
});

describe("outbound email is deduplicated", () => {
  before(async () => {
    await wipe(shop);
    await ensureShopSettings(shop);
  });

  after(async () => {
    await wipe(shop);
  });

  it("queues one message per template even when the notifier runs twice", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Test Buyer",
      email: "buyer@example.com",
      items: [{ plantName: "Anthurium Warocqueanum" }],
    });

    await notifyNewRequest(shop, created.id);
    await notifyNewRequest(shop, created.id);

    const messages = await prisma.emailMessage.findMany({
      where: { shop, requestId: created.id, templateKey: "request_received" },
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].idempotencyKey, `request_received:${created.id}`);
  });
});

describe("customer request visibility", () => {
  before(async () => {
    await wipe(shop);
    await ensureShopSettings(shop);
  });

  after(async () => {
    await wipe(shop);
  });

  it("hides a request claimed by another Shopify account with the same email", async () => {
    await offeredRequest({
      email: "shared@example.com",
      shopifyCustomerId: "1001",
    });

    const otherAccount = await listCustomerRequests(shop, {
      email: "shared@example.com",
      shopifyCustomerId: "2002",
    });
    assert.equal(otherAccount.length, 0);

    const owner = await listCustomerRequests(shop, {
      email: "shared@example.com",
      shopifyCustomerId: "1001",
    });
    assert.equal(owner.length, 1);
  });
});

describe("privacy redaction", () => {
  before(async () => {
    await wipe(shop);
    await ensureShopSettings(shop);
  });

  after(async () => {
    await wipe(shop);
  });

  it("erases only the subject's requests", async () => {
    const target = await offeredRequest({
      email: "erase-me@example.com",
      shopifyCustomerId: "3003",
    });
    const bystander = await offeredRequest({
      email: "keep-me@example.com",
      shopifyCustomerId: "4004",
    });
    await notifyNewRequest(shop, target.id);

    const result = await handleCustomerRedact(shop, {
      customer: { id: "3003", email: "erase-me@example.com" },
    });
    assert.equal(result.profilesDeleted, 1);

    assert.equal(
      await prisma.plantRequest.count({ where: { id: target.id } }),
      0,
    );
    assert.equal(
      await prisma.plantRequest.count({ where: { id: bystander.id } }),
      1,
    );
    assert.equal(
      await prisma.emailMessage.count({ where: { shop, requestId: target.id } }),
      0,
    );
  });

  it("erases everything for a shop", async () => {
    await offeredRequest();
    await handleShopRedact(shop);

    assert.equal(await prisma.plantRequest.count({ where: { shop } }), 0);
    assert.equal(await prisma.customerProfile.count({ where: { shop } }), 0);
    assert.equal(await prisma.shopSettings.count({ where: { shop } }), 0);
  });
});

beforeEach(() => {
  // Guard against a stray production flag leaking between suites.
  assert.notEqual(process.env.NODE_ENV, "production");
});
