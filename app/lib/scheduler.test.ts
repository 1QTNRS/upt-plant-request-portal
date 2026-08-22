import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import {
  cronSecretMatches,
  readCronSecret,
  runOfferMaintenance,
} from "./scheduler.server";
import { ensureShopSettings } from "./seed-demo.server";
import { DEMO_SHOP } from "./shop";

describe("cron secret comparison", () => {
  it("accepts the configured secret", () => {
    assert.equal(cronSecretMatches("s3cret", "s3cret"), true);
  });

  it("rejects a wrong secret", () => {
    assert.equal(cronSecretMatches("wrong", "s3cret"), false);
  });

  it("rejects a secret of a different length without leaking it", () => {
    assert.equal(cronSecretMatches("s3cretttttt", "s3cret"), false);
    assert.equal(cronSecretMatches("s3c", "s3cret"), false);
  });

  it("rejects a missing header", () => {
    assert.equal(cronSecretMatches(null, "s3cret"), false);
    assert.equal(cronSecretMatches(undefined, "s3cret"), false);
    assert.equal(cronSecretMatches("", "s3cret"), false);
  });

  it("rejects everything when no secret is configured", () => {
    assert.equal(cronSecretMatches("anything", undefined), false);
    assert.equal(cronSecretMatches("anything", ""), false);
  });
});

describe("cron secret extraction", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("https://portal.example.com/cron/offer-maintenance", {
      method: "POST",
      headers,
    });
  }

  it("reads a bearer token", () => {
    assert.equal(
      readCronSecret(requestWith({ Authorization: "Bearer s3cret" })),
      "s3cret",
    );
  });

  it("accepts a lowercase bearer scheme", () => {
    assert.equal(
      readCronSecret(requestWith({ Authorization: "bearer s3cret" })),
      "s3cret",
    );
  });

  it("reads the X-Cron-Secret header", () => {
    assert.equal(readCronSecret(requestWith({ "X-Cron-Secret": "s3cret" })), "s3cret");
  });

  it("returns null when neither header is present", () => {
    assert.equal(readCronSecret(requestWith({})), null);
  });

  it("does not read the secret from the query string", () => {
    const request = new Request(
      "https://portal.example.com/cron/offer-maintenance?secret=s3cret",
      { method: "POST" },
    );
    assert.equal(readCronSecret(request), null);
  });
});

describe("maintenance reporting", () => {
  const shop = `${DEMO_SHOP}-scheduler-test`;

  async function purge() {
    await prisma.emailMessage.deleteMany({ where: { shop } });
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  }

  before(async () => {
    await purge();
    await ensureShopSettings(shop);
  });
  after(purge);

  it("counts reminders queued and reminders delivered apart", async () => {
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
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);
    await prisma.offer.update({
      where: { requestId: created.id },
      data: { expiresAt },
    });

    const result = await runOfferMaintenance("https://portal.example.com");
    const entry = result.shops.find((row) => row.shop === shop);

    assert.ok(entry, "the shop must appear in the run");
    assert.equal(entry.remindersQueued, 1);
    // Nothing was delivered: RESEND_API_KEY is unset, so the row is `preview`.
    // Counting rows alone reported this run as having reminded someone.
    assert.equal(entry.remindersSent, 0);
    assert.equal(
      (
        await prisma.emailMessage.findFirstOrThrow({
          where: { shop, templateKey: "expiration_reminder" },
        })
      ).status,
      "preview",
    );
  });
});
