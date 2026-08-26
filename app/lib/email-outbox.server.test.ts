import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import prisma from "../db.server";
import {
  listEmailsForRequest,
  notifyAdminPaymentAfterVoid,
  notifyAdminResponse,
  notifyExpirationReminders,
  notifyNewRequest,
  notifyOfferReady,
  queueEmail,
  redeliverEmailMessage,
  redeliverPendingEmails,
  type EmailSender,
} from "./emails.server";
import {
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
} from "./portal.server";
import { ensureShopSettings } from "./seed-demo.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-email-outbox-test`;
const APP_URL = "https://portal.example.com";

/** Records every send and answers with the queued outcomes in order. */
function fakeSender(outcomes: Array<"ok" | "retryable" | "permanent">): {
  sender: EmailSender;
  sent: Array<{ id: string; toEmail: string; subject: string }>;
} {
  const sent: Array<{ id: string; toEmail: string; subject: string }> = [];
  let call = 0;
  const sender: EmailSender = async (message) => {
    sent.push({
      id: message.id,
      toEmail: message.toEmail,
      subject: message.subject,
    });
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    if (outcome === "ok") {
      return { ok: true, providerMessageId: `resend-${call}` };
    }
    return {
      ok: false,
      error: outcome === "retryable" ? "Resend responded 503: busy" : "Resend responded 422: bad address",
      retryable: outcome === "retryable",
    };
  };
  return { sender, sent };
}

async function purge() {
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

/** A sent offer with one available plant priced for checkout. */
async function offeredRequest(options?: { expiresInHours?: number }) {
  const created = await submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [{ plantName: "Monstera Albo" }],
  });
  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: created.items[0].id,
    availability: "available",
    price: 250,
    weightLbs: 2,
    photoUrls: ["https://cdn.example.com/monstera.jpg"],
  });
  await sendOffer(shop, created.id, 3);

  if (options?.expiresInHours !== undefined) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + options.expiresInHours);
    await prisma.offer.update({
      where: { requestId: created.id },
      data: { expiresAt },
    });
  }

  return created;
}

describe("a message Resend refused is not lost", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  it("records the failure and the attempts it cost", async () => {
    const { sender, sent } = fakeSender(["retryable"]);
    const message = await queueEmail({
      shop,
      toEmail: "buyer@example.com",
      subject: "Offer ready",
      bodyText: "Review your offer.",
      templateKey: "offer_ready",
      idempotencyKey: "offer_ready:failing",
      sender,
    });

    assert.equal(message?.status, "failed");
    assert.equal(message?.attempts, 3, "three attempts, as configured");
    assert.equal(sent.length, 3);
    assert.match(message?.error ?? "", /503/);
  });

  it("stops immediately on a failure Resend will repeat", async () => {
    const { sender, sent } = fakeSender(["permanent"]);
    const message = await queueEmail({
      shop,
      toEmail: "nope@example.com",
      subject: "Offer ready",
      bodyText: "Review your offer.",
      templateKey: "offer_ready",
      idempotencyKey: "offer_ready:permanent",
      sender,
    });

    assert.equal(message?.status, "failed");
    assert.equal(sent.length, 1, "a rejected address is not worth retrying");
  });

  it("tries again the next time the same message is queued", async () => {
    // This is the whole point: the dedup key used to return the failed row
    // untouched, so nothing ever attempted delivery again.
    const { sender } = fakeSender(["ok"]);
    const retried = await queueEmail({
      shop,
      toEmail: "buyer@example.com",
      subject: "Offer ready",
      bodyText: "Review your offer.",
      templateKey: "offer_ready",
      idempotencyKey: "offer_ready:failing",
      sender,
    });

    assert.equal(retried?.status, "sent");
    assert.ok(retried?.sentAt);
    assert.equal(retried?.error, null);
    assert.equal(retried?.providerMessageId, "resend-1");
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, idempotencyKey: "offer_ready:failing" },
      }),
      1,
      "retrying must not create a second row",
    );
  });

  it("never sends a message that already went out", async () => {
    const { sender, sent } = fakeSender(["ok"]);
    const again = await queueEmail({
      shop,
      toEmail: "buyer@example.com",
      subject: "Offer ready",
      bodyText: "Review your offer.",
      templateKey: "offer_ready",
      idempotencyKey: "offer_ready:failing",
      sender,
    });

    assert.equal(again?.status, "sent");
    assert.equal(sent.length, 0, "a sent message must not be sent twice");
  });

  it("logs a blank recipient instead of silently queueing nothing", async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      const result = await queueEmail({
        shop,
        toEmail: "   ",
        subject: "New plant request",
        bodyText: "REQ1",
        templateKey: "admin_new_request",
        requestId: "req-123",
      });
      assert.equal(result, null);
    } finally {
      console.warn = original;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /admin_new_request/);
    assert.match(warnings[0], /req-123/);
  });
});

describe("the redelivery sweep", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  beforeEach(async () => {
    await prisma.emailMessage.deleteMany({ where: { shop } });
  });

  async function seedOutbox() {
    // Distinct createdAt values so "oldest first" is observable.
    const rows = [
      { key: "a", status: "failed", minutesAgo: 30, attempts: 3 },
      { key: "b", status: "preview", minutesAgo: 20, attempts: 0 },
      { key: "c", status: "queued", minutesAgo: 10, attempts: 0 },
      { key: "d", status: "sent", minutesAgo: 5, attempts: 1 },
    ];
    for (const row of rows) {
      await prisma.emailMessage.create({
        data: {
          shop,
          toEmail: `${row.key}@example.com`,
          subject: `Message ${row.key}`,
          bodyText: "body",
          templateKey: "offer_ready",
          idempotencyKey: `sweep:${row.key}`,
          status: row.status,
          attempts: row.attempts,
          createdAt: new Date(Date.now() - row.minutesAgo * 60_000),
        },
      });
    }
  }

  it("retries everything undelivered and leaves sent messages alone", async () => {
    await seedOutbox();
    const { sender, sent } = fakeSender(["ok"]);

    const result = await redeliverPendingEmails(shop, { sender });

    assert.deepEqual(result, { attempted: 3, delivered: 3 });
    assert.deepEqual(
      sent.map((message) => message.toEmail),
      ["a@example.com", "b@example.com", "c@example.com"],
      "oldest first, and never the sent one",
    );
    assert.equal(
      await prisma.emailMessage.count({ where: { shop, status: "sent" } }),
      4,
    );
  });

  it("is bounded per run so one shop cannot monopolise the sweep", async () => {
    await seedOutbox();
    const { sender, sent } = fakeSender(["ok"]);

    const result = await redeliverPendingEmails(shop, { sender, limit: 2 });

    assert.deepEqual(result, { attempted: 2, delivered: 2 });
    assert.deepEqual(
      sent.map((message) => message.toEmail),
      ["a@example.com", "b@example.com"],
    );
  });

  it("reports a failure rather than counting it as delivered", async () => {
    await seedOutbox();
    const { sender } = fakeSender(["permanent"]);

    const result = await redeliverPendingEmails(shop, { sender });
    assert.deepEqual(result, { attempted: 3, delivered: 0 });
  });

  it("gives up on a message that has used its attempt budget", async () => {
    await prisma.emailMessage.create({
      data: {
        shop,
        toEmail: "exhausted@example.com",
        subject: "Offer ready",
        bodyText: "body",
        templateKey: "offer_ready",
        idempotencyKey: "sweep:exhausted",
        status: "failed",
        attempts: 24,
        error: "Resend responded 422: bad address",
      },
    });
    const { sender } = fakeSender(["ok"]);

    assert.deepEqual(await redeliverPendingEmails(shop, { sender }), {
      attempted: 0,
      delivered: 0,
    });
  });

  it("does nothing, and buries nothing, when there is no Resend key", async () => {
    await seedOutbox();
    // RESEND_API_KEY is unset in development and in this suite.
    assert.equal(process.env.RESEND_API_KEY, undefined);

    assert.deepEqual(await redeliverPendingEmails(shop), {
      attempted: 0,
      delivered: 0,
    });
    const failed = await prisma.emailMessage.findFirstOrThrow({
      where: { shop, idempotencyKey: "sweep:a" },
    });
    assert.equal(failed.status, "failed", "the recorded state must survive");
  });

  it("retries one message on demand past the attempt budget", async () => {
    await prisma.emailMessage.create({
      data: {
        shop,
        toEmail: "exhausted@example.com",
        subject: "Offer ready",
        bodyText: "body",
        templateKey: "offer_ready",
        idempotencyKey: "sweep:on-demand",
        status: "failed",
        attempts: 40,
      },
    });
    const row = await prisma.emailMessage.findFirstOrThrow({
      where: { shop, idempotencyKey: "sweep:on-demand" },
    });
    const { sender } = fakeSender(["ok"]);

    const retried = await redeliverEmailMessage(shop, row.id, { sender });
    assert.equal(retried?.status, "sent");
  });

  it("refuses a message id from another shop", async () => {
    await seedOutbox();
    const row = await prisma.emailMessage.findFirstOrThrow({
      where: { shop, idempotencyKey: "sweep:a" },
    });
    const { sender } = fakeSender(["ok"]);

    assert.equal(
      await redeliverEmailMessage(`${shop}-neighbour`, row.id, { sender }),
      null,
    );
  });
});

describe("the offer-ready email can be sent again", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  it("attempts delivery again rather than handing back the failed row", async () => {
    const created = await offeredRequest();
    const first = await notifyOfferReady(shop, created.id, APP_URL);
    assert.equal(first?.status, "preview", "no Resend key means nothing was sent");

    await prisma.emailMessage.update({
      where: { id: first!.id },
      data: { status: "failed", error: "Resend responded 503: busy", attempts: 3 },
    });

    // sendOffer commits the offer and moves the request out of New, so it
    // refuses to run twice; this is the only route back to the customer.
    const resent = await notifyOfferReady(shop, created.id, APP_URL);

    assert.equal(resent?.id, first!.id, "the same outbox row is reused");
    assert.notEqual(resent?.status, "failed", "delivery was attempted again");
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "offer_ready" },
      }),
      1,
    );
  });
});

describe("automatic expiration reminders are not sent", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  it("queues nothing even when a hold is about to lapse", async () => {
    const created = await offeredRequest({ expiresInHours: 6 });

    await notifyExpirationReminders(shop, APP_URL);
    await notifyExpirationReminders(shop, APP_URL);

    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "expiration_reminder" },
      }),
      0,
      "a reminder would be a fourth customer email on the happy path",
    );
  });
});

describe("the outbox the merchant is shown", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  it("withholds the message body, which carries payment links", async () => {
    const created = await offeredRequest();
    await notifyOfferReady(shop, created.id, APP_URL);

    const [row] = await listEmailsForRequest(shop, created.id);
    assert.ok(row, "the request must have an outbox row");
    assert.ok(!("bodyText" in row), "bodyText must not reach the browser");
    assert.equal(row.templateKey, "offer_ready");
    assert.equal(row.attempts, 0);
  });
});

describe("customer and admin email volume", () => {
  before(async () => {
    await purge();
    await ensureShopSettings(shop);
    await updateShopSettings(shop, { adminNotificationEmail: "upt@example.com" });
  });
  after(purge);

  it("does not email the customer a request-received confirmation", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Hoya Linearis" }],
    });
    await notifyNewRequest(shop, created.id);

    const rows = await prisma.emailMessage.findMany({
      where: { shop, requestId: created.id },
    });
    assert.equal(
      rows.some((row) => row.templateKey === "request_received"),
      false,
    );
    assert.equal(
      rows.filter((row) => row.templateKey === "admin_new_request").length,
      1,
    );
    assert.equal(rows[0]?.toEmail, "upt@example.com");
  });

  it("skips an admin email the shop has unsubscribed from", async () => {
    await updateShopSettings(shop, {
      adminEmailNewRequest: false,
      adminEmailCustomerResponse: false,
      adminEmailPaymentAfterVoid: false,
    });
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Philodendron Gloriosum" }],
    });
    await notifyNewRequest(shop, created.id);
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
          templateKey: {
            in: ["admin_new_request", "admin_response", "admin_payment_after_void"],
          },
        },
      }),
      0,
    );
  });
});
