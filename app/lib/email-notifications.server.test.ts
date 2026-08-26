import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  notifyAdminPaymentAfterVoid,
  notifyAdminResponse,
  notifyExpirationReminders,
  notifyNewRequest,
  notifyOfferReady,
} from "./emails.server";
import {
  adminOverrideCloseRequest,
  createPaymentLinkForRequest,
  handleCustomerOfferAction,
} from "./offer-response.server";
import {
  getDraftOrder,
  getRequest,
  getShopSettings,
  markRequestPaid,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-email-notifications-test`;
const merchantShop = "email-notifications-merchant.myshopify.com";
const APP_URL = "https://portal.example.com";
const ADMIN = "upt-notify@example.com";

async function purgeShop(target: string) {
  await prisma.emailMessage.deleteMany({ where: { shop: target } });
  await prisma.plantRequest.deleteMany({ where: { shop: target } });
  await prisma.customerProfile.deleteMany({ where: { shop: target } });
  await prisma.shopSettings.deleteMany({ where: { shop: target } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop: target } });
}

async function purge() {
  await purgeShop(shop);
  await purgeShop(merchantShop);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function seedAdminEmail(target = shop) {
  await updateShopSettings(target, { adminNotificationEmail: ADMIN });
}

function customerTemplates(requestId: string, target = shop) {
  return prisma.emailMessage.findMany({
    where: {
      shop: target,
      requestId,
      templateKey: {
        in: [
          "request_received",
          "offer_ready",
          "confirmation",
          "checkout_link",
          "expiration_reminder",
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function submitAndNotify(input: {
  target?: string;
  plants: string[];
  email?: string;
}) {
  const target = input.target ?? shop;
  const created = await submitCustomerRequest(target, {
    name: "Alex Rivera",
    email: input.email ?? "alex.rivera@example.com",
    items: input.plants.map((plantName) => ({ plantName })),
  });
  await notifyNewRequest(target, created.id);
  return created;
}

describe("admin email notification toggles", () => {
  before(purge);
  after(purge);

  it("persists each toggle independently per shop", async () => {
    await seedAdminEmail();
    const defaults = await getShopSettings(shop);
    assert.equal(defaults.adminEmailNewRequest, true);
    assert.equal(defaults.adminEmailCustomerResponse, true);
    assert.equal(defaults.adminEmailPaymentAfterVoid, true);

    await updateShopSettings(shop, { adminEmailNewRequest: false });
    let settings = await getShopSettings(shop);
    assert.equal(settings.adminEmailNewRequest, false);
    assert.equal(settings.adminEmailCustomerResponse, true);
    assert.equal(settings.adminEmailPaymentAfterVoid, true);

    await updateShopSettings(shop, { adminEmailCustomerResponse: false });
    settings = await getShopSettings(shop);
    assert.equal(settings.adminEmailNewRequest, false);
    assert.equal(settings.adminEmailCustomerResponse, false);
    assert.equal(settings.adminEmailPaymentAfterVoid, true);

    await updateShopSettings(shop, { adminEmailPaymentAfterVoid: false });
    settings = await getShopSettings(shop);
    assert.equal(settings.adminEmailPaymentAfterVoid, false);
    assert.equal(settings.adminNotificationEmail, ADMIN);
  });

  it("sends an enabled admin type and skips a disabled one", async () => {
    await seedAdminEmail();
    await updateShopSettings(shop, {
      adminEmailNewRequest: true,
      adminEmailCustomerResponse: false,
      adminEmailPaymentAfterVoid: false,
    });

    const created = await submitAndNotify({ plants: ["Monstera Albo"] });
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "admin_new_request" },
      }),
      1,
    );
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "request_received" },
      }),
      1,
      "the customer confirmation is not an admin toggle",
    );

    await notifyAdminResponse(shop, {
      requestId: created.id,
      acceptedCount: 1,
      rejectedCount: 0,
    });
    await notifyAdminPaymentAfterVoid(shop, { requestId: created.id });
    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop,
          requestId: created.id,
          templateKey: { in: ["admin_response", "admin_payment_after_void"] },
        },
      }),
      0,
    );
  });

  it("does not stop the underlying action when an admin email is off", async () => {
    await seedAdminEmail();
    await updateShopSettings(shop, {
      adminEmailNewRequest: false,
      adminEmailCustomerResponse: false,
    });

    const created = await submitAndNotify({ plants: ["Monstera Albo"] });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 120,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/albo.jpg"],
    });
    const sent = await sendOffer(shop, created.id, 3);
    assert.equal(sent?.status, "Pending");
    await notifyOfferReady(shop, created.id, APP_URL);

    const result = await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    assert.equal(result.ok, true);
    assert.ok(await getDraftOrder(shop, created.id));
    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop,
          requestId: created.id,
          templateKey: { in: ["admin_new_request", "admin_response"] },
        },
      }),
      0,
    );
    assert.equal((await getRequest(shop, created.id))?.status, "Pending");
  });
});

describe("the Settings page exposes the admin email toggles", () => {
  it("labels the section and each notification type", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    assert.match(source, /Admin Email Notifications/);
    assert.match(source, /New request submitted/);
    assert.match(source, /Customer responded to an offer/);
    assert.match(source, /Important payment\/conflict alerts/);
    assert.match(source, /name="adminEmailNewRequest"/);
    assert.match(source, /name="adminEmailCustomerResponse"/);
    assert.match(source, /name="adminEmailPaymentAfterVoid"/);
    assert.match(source, /intent" value="save-admin-emails"/);
  });
});

describe("customer email count on the happy path with payment", () => {
  before(purge);
  after(purge);

  it("sends request received and one admin-response email, then no portal payment mail", async () => {
    await seedAdminEmail();
    const created = await submitAndNotify({ plants: ["Monstera Albo"] });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 250,
      weightLbs: 2,
      customerFacingNotes: "Rooted cutting.",
      photoUrls: ["https://cdn.example.com/albo.jpg"],
    });
    await sendOffer(shop, created.id, 3);
    await notifyOfferReady(shop, created.id, APP_URL);

    const result = await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    assert.equal(result.ok, true);
    const draft = await getDraftOrder(shop, created.id);
    assert.ok(draft?.invoiceUrl, "Accept still creates a payable Draft Order");

    await notifyExpirationReminders(shop, APP_URL);
    await markRequestPaid(shop, created.id, {
      shopifyOrderGid: "gid://shopify/Order/1",
      orderNumber: "#1001",
      plantRevenue: 250,
    });
    await markRequestPaid(shop, created.id, {
      shopifyOrderGid: "gid://shopify/Order/1",
      orderNumber: "#1001",
      plantRevenue: 250,
    });

    const customer = await customerTemplates(created.id);
    assert.deepEqual(
      customer.map((email) => email.templateKey),
      ["request_received", "offer_ready"],
    );
    assert.equal(
      customer.filter((email) => email.templateKey === "request_received").length,
      1,
    );
    assert.equal(
      customer.filter((email) => email.templateKey === "offer_ready").length,
      1,
    );
    const offer = customer.find((email) => email.templateKey === "offer_ready")!;
    assert.match(offer.bodyText, /Available:\n- Monstera Albo — Rooted cutting\./);
    assert.doesNotMatch(offer.bodyText, /payment|invoice|checkout/i);

    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop,
          requestId: created.id,
          toEmail: "alex.rivera@example.com",
          templateKey: { in: ["confirmation", "checkout_link", "expiration_reminder"] },
        },
      }),
      0,
      "no extra automatic portal customer emails after Accept or payment",
    );
  });
});

describe("customer email count when no payment is needed", () => {
  before(purge);
  after(purge);

  it("stops at request received plus the admin-response summary", async () => {
    await seedAdminEmail();
    const created = await submitAndNotify({
      plants: ["Monstera Albo", "Hoya"],
    });
    for (const item of created.items) {
      await updateRequestItem(shop, {
        requestId: created.id,
        itemId: item.id,
        availability: "available",
        price: 80,
        weightLbs: 1,
        photoUrls: [`https://cdn.example.com/${item.id}.jpg`],
      });
    }
    await sendOffer(shop, created.id, 3);
    await notifyOfferReady(shop, created.id, APP_URL);

    await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "reject",
        [`choice-${created.items[1].id}`]: "reject",
        fedexUpgradeSelected: "true",
      }),
    });
    const closed = await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({ intent: "close-request" }),
    });
    assert.equal(closed.ok, true);

    const customer = await customerTemplates(created.id);
    assert.deepEqual(
      customer.map((email) => email.templateKey),
      ["request_received", "offer_ready"],
    );
    assert.equal(await getDraftOrder(shop, created.id), null);
    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop,
          requestId: created.id,
          templateKey: { in: ["confirmation", "checkout_link"] },
        },
      }),
      0,
    );
  });
});

describe("customer email count when the response is unavailable-only", () => {
  before(purge);
  after(purge);

  it("sends a thank-you admin-response email with no payment link", async () => {
    await seedAdminEmail();
    const created = await submitAndNotify({ plants: ["Missing Fern"] });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });
    await sendOffer(shop, created.id, 3);
    await notifyOfferReady(shop, created.id, APP_URL);
    const closed = await adminOverrideCloseRequest({
      shop,
      requestId: created.id,
      confirmed: true,
    });
    assert.equal(closed.ok, true);

    const customer = await customerTemplates(created.id);
    assert.deepEqual(
      customer.map((email) => email.templateKey),
      ["request_received", "offer_ready"],
    );
    const offer = customer.find((email) => email.templateKey === "offer_ready")!;
    assert.match(offer.bodyText, /None of the requested plants are available/);
    assert.match(offer.bodyText, /not in our current inventory/);
    assert.match(offer.bodyText, /No payment is needed/);
    assert.doesNotMatch(offer.bodyText, /invoice|checkout/i);
    assert.equal(await getDraftOrder(shop, created.id), null);
  });
});

describe("customer email idempotency", () => {
  before(purge);
  after(purge);

  it("does not duplicate request received, offer ready, or admin response", async () => {
    await seedAdminEmail();
    const created = await submitAndNotify({ plants: ["Monstera Albo"] });
    await notifyNewRequest(shop, created.id);
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 90,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/albo.jpg"],
    });
    await sendOffer(shop, created.id, 3);
    await notifyOfferReady(shop, created.id, APP_URL);
    await notifyOfferReady(shop, created.id, APP_URL);

    await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    const again = await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    assert.equal("alreadySubmitted" in again ? again.alreadySubmitted : null, true);

    await notifyAdminPaymentAfterVoid(shop, { requestId: created.id });
    await notifyAdminPaymentAfterVoid(shop, { requestId: created.id });

    const keys = (
      await prisma.emailMessage.findMany({
        where: { shop, requestId: created.id },
        select: { templateKey: true, idempotencyKey: true },
      })
    )
      .map((row) => row.idempotencyKey)
      .sort();
    assert.deepEqual(keys, [
      `admin_new_request:${created.id}`,
      `admin_payment_after_void:${created.id}`,
      `admin_response:${created.id}`,
      `offer_ready:${created.id}`,
      `request_received:${created.id}`,
    ]);
  });

  it("keeps a manual payment-link resend on its own idempotency key", async () => {
    await seedAdminEmail();
    const created = await submitAndNotify({ plants: ["Monstera Albo"] });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 90,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/albo.jpg"],
    });
    await sendOffer(shop, created.id, 3);
    await notifyOfferReady(shop, created.id, APP_URL);
    await handleCustomerOfferAction({
      shop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    await prisma.draftOrderReference.deleteMany({ where: { requestId: created.id } });

    const first = await createPaymentLinkForRequest({ shop, requestId: created.id });
    const second = await createPaymentLinkForRequest({ shop, requestId: created.id });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "checkout_link" },
      }),
      1,
    );
  });
});

describe("expired invoice recovery does not send a Shopify invoice email", () => {
  before(purge);
  after(purge);

  it("leaves the customer outbox unchanged when the hold is already over", async () => {
    await seedAdminEmail(merchantShop);
    const created = await submitAndNotify({
      target: merchantShop,
      plants: ["Monstera Albo"],
    });
    await updateRequestItem(merchantShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 90,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/albo.jpg"],
    });
    await sendOffer(merchantShop, created.id, 3);
    await notifyOfferReady(merchantShop, created.id, APP_URL);
    await handleCustomerOfferAction({
      shop: merchantShop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    await prisma.offer.update({
      where: { requestId: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const recovered = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId: created.id,
    });
    assert.equal(recovered.ok, false);

    const customer = await customerTemplates(created.id, merchantShop);
    assert.deepEqual(
      customer.map((email) => email.templateKey),
      ["request_received", "offer_ready"],
    );
    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop: merchantShop,
          requestId: created.id,
          templateKey: "checkout_link",
        },
      }),
      0,
    );
  });
});
