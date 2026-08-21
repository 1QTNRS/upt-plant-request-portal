import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  formatCustomerDataExport,
  handleCustomerDataRequest,
  handleCustomerRedact,
  handleShopRedact,
} from "./compliance.server";
import { DEMO_SHOP } from "./shop";
import { ensureShopSeeded } from "./seed-demo.server";
import { updateShopSettings } from "./portal.server";

const shop = `${DEMO_SHOP}-compliance-test`;
const otherShop = `${DEMO_SHOP}-compliance-neighbour`;
const ADMIN_EMAIL = "orders@unsolicitedplanttalks.test";

async function purge(target: string) {
  await prisma.emailMessage.deleteMany({ where: { shop: target } });
  await prisma.plantRequest.deleteMany({ where: { shop: target } });
  await prisma.customerProfile.deleteMany({ where: { shop: target } });
  await prisma.shopSettings.deleteMany({ where: { shop: target } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop: target } });
}

async function reseed() {
  await purge(shop);
  await ensureShopSeeded(shop);
  await updateShopSettings(shop, { adminNotificationEmail: ADMIN_EMAIL });
  await prisma.customerProfile.updateMany({
    where: { shop, email: "alex.rivera@example.com" },
    data: { shopifyCustomerId: "7654321" },
  });
}

describe("customers/data_request", () => {
  before(reseed);
  after(() => purge(shop));

  it("collects the customer's stored requests by Shopify customer id", async () => {
    const exports = await handleCustomerDataRequest(shop, {
      customer: { id: 7654321 },
    });

    assert.equal(exports.length, 1);
    assert.equal(exports[0].customer.email, "alex.rivera@example.com");
    assert.ok(exports[0].requests.length > 0);
    assert.ok(exports[0].requests.every((request) => request.requestNumber.startsWith("REQ")));
  });

  it("falls back to matching on the email address", async () => {
    const exports = await handleCustomerDataRequest(shop, {
      customer: { email: "J.Chen@email.com" },
    });
    assert.equal(exports.length, 1);
    assert.equal(exports[0].customer.name, "James Chen");
  });

  it("hands the export to the outbox rather than leaving it in the table", async () => {
    await prisma.emailMessage.deleteMany({
      where: { shop, templateKey: "compliance_data_request" },
    });
    await handleCustomerDataRequest(shop, {
      customer: { id: 7654321 },
      data_request: { id: 55501 },
    });

    const queued = await prisma.emailMessage.findFirst({
      where: { shop, templateKey: "compliance_data_request" },
    });
    assert.ok(queued, "a data request must produce an outbox message");
    assert.equal(queued.toEmail, ADMIN_EMAIL);
    assert.match(queued.bodyText, /alex\.rivera@example\.com/);
    // Nothing reads a `queued` row. Writing one straight to the table left this
    // export undelivered while the webhook logged success — and this is one of
    // Shopify's mandatory privacy topics, with a response deadline attached.
    assert.notEqual(
      queued.status,
      "queued",
      "delivery must have been attempted, not merely recorded",
    );
    assert.equal(queued.idempotencyKey, "compliance_data_request:55501");
  });

  it("produces one export when Shopify redelivers the same request", async () => {
    await prisma.emailMessage.deleteMany({
      where: { shop, templateKey: "compliance_data_request" },
    });
    const payload = {
      customer: { id: 7654321 },
      data_request: { id: 55502 },
    };
    await handleCustomerDataRequest(shop, payload);
    await handleCustomerDataRequest(shop, payload);

    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, templateKey: "compliance_data_request" },
      }),
      1,
    );
  });

  it("returns nothing when the payload identifies no customer", async () => {
    assert.deepEqual(await handleCustomerDataRequest(shop, {}), []);
  });

  it("reports plainly when the portal holds no data", () => {
    assert.match(formatCustomerDataExport([]), /holds no data/);
  });
});

describe("customers/redact", () => {
  before(reseed);
  after(() => purge(shop));

  it("erases the customer, their requests and their queued emails", async () => {
    const before = await prisma.customerProfile.findFirstOrThrow({
      where: { shop, email: "alex.rivera@example.com" },
      include: { requests: true },
    });
    assert.ok(before.requests.length > 0);

    const result = await handleCustomerRedact(shop, { customer: { id: 7654321 } });
    assert.equal(result.profilesDeleted, 1);

    assert.equal(
      await prisma.customerProfile.count({
        where: { shop, email: "alex.rivera@example.com" },
      }),
      0,
    );
    assert.equal(
      await prisma.plantRequest.count({ where: { shop, customerId: before.id } }),
      0,
    );
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, toEmail: "alex.rivera@example.com" },
      }),
      0,
    );
  });

  it("leaves other customers untouched", async () => {
    assert.ok(
      await prisma.customerProfile.findFirst({
        where: { shop, email: "j.chen@email.com" },
      }),
    );
    assert.ok((await prisma.plantRequest.count({ where: { shop } })) > 0);
  });

  it("is safe to replay", async () => {
    const result = await handleCustomerRedact(shop, { customer: { id: 7654321 } });
    assert.deepEqual(result, { profilesDeleted: 0, emailsDeleted: 0 });
  });
});

describe("shop/redact", () => {
  before(async () => {
    await reseed();
    await purge(otherShop);
    await ensureShopSeeded(otherShop);
  });
  after(async () => {
    await purge(shop);
    await purge(otherShop);
  });

  it("erases every record for the shop", async () => {
    assert.ok((await prisma.plantRequest.count({ where: { shop } })) > 0);

    await handleShopRedact(shop);

    for (const count of await Promise.all([
      prisma.plantRequest.count({ where: { shop } }),
      prisma.customerProfile.count({ where: { shop } }),
      prisma.shopSettings.count({ where: { shop } }),
      prisma.requestNumberSequence.count({ where: { shop } }),
      prisma.emailMessage.count({ where: { shop } }),
      prisma.exactPlantListing.count({ where: { shop } }),
      prisma.session.count({ where: { shop } }),
    ])) {
      assert.equal(count, 0);
    }
  });

  it("does not touch another shop's data", async () => {
    assert.ok((await prisma.plantRequest.count({ where: { shop: otherShop } })) > 0);
    assert.ok((await prisma.customerProfile.count({ where: { shop: otherShop } })) > 0);
  });
});
