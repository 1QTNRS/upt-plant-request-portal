import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { ensureShopSeeded, ensureShopSettings } from "./seed-demo.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-seed-guard-test`;

async function purge() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

describe("demo seed guard", () => {
  before(purge);
  after(purge);

  it("does not create demo requests in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await ensureShopSeeded(shop);
    } finally {
      process.env.NODE_ENV = original;
    }

    assert.equal(
      await prisma.plantRequest.count({ where: { shop } }),
      0,
      "a production admin load must not file demo requests against the real store",
    );
  });

  it("still creates the shop settings row in production", async () => {
    assert.ok(await prisma.shopSettings.findUnique({ where: { shop } }));
  });

  it("creates demo requests outside production", async () => {
    await ensureShopSeeded(shop);
    assert.ok((await prisma.plantRequest.count({ where: { shop } })) >= 6);
  });

  it("ensureShopSettings is idempotent", async () => {
    await ensureShopSettings(shop);
    await ensureShopSettings(shop);
    assert.equal(await prisma.shopSettings.count({ where: { shop } }), 1);
  });
});
