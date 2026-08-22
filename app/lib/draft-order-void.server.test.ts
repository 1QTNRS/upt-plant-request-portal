import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  COMPLETED_BEFORE_VOID,
  VOID_CLAIM_MS,
  voidExpiredDraftOrder,
  voidExpiredDraftOrders,
} from "./draft-order-void.server";
import {
  INVOICE_VOIDED_REASON,
  PAYMENT_AFTER_VOID_REASON,
} from "./portal";
import { markRequestPaid } from "./portal.server";
import { DEMO_SHOP } from "./shop";
import type { GraphqlClient } from "./shopify-ops.server";

const merchantShop = "expired-invoice-void-merchant.myshopify.com";
const demoShop = `${DEMO_SHOP}-expired-invoice-void`;

const DRAFT_GID = "gid://shopify/DraftOrder/9001";
const INVOICE_URL = "https://expired-invoice-void-merchant.myshopify.com/invoices/9001";

type Call = { operation: string; variables: Record<string, unknown> };

function fakeAdmin(responses: Record<string, unknown>, calls: Call[]): GraphqlClient {
  return {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      const operation = query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
      calls.push({ operation, variables: options?.variables ?? {} });
      const data = responses[operation];
      assert.ok(data !== undefined, `unexpected Shopify operation ${operation}`);
      return { json: async () => ({ data }) };
    },
  } as unknown as GraphqlClient;
}

async function purge(shop: string) {
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

async function reset() {
  await purge(merchantShop);
  await purge(demoShop);
}

async function seedExpiredWithDraft(
  shop: string,
  requestNumber: string,
  overrides?: {
    status?: string;
    paidAt?: Date | null;
    voidedAt?: Date | null;
    voidError?: string | null;
    voidStartedAt?: Date | null;
    invoiceUrl?: string | null;
    shopifyDraftOrderGid?: string | null;
  },
) {
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email: "void@example.com" } },
    create: { shop, name: "Void Customer", email: "void@example.com" },
    update: {},
  });

  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: "Void Customer",
      customerEmail: "void@example.com",
      status: overrides?.status ?? "Expired",
      expiredAt: new Date(Date.now() - 60 * 60 * 1000),
      paidAt: overrides?.paidAt ?? null,
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

  await prisma.draftOrderReference.create({
    data: {
      requestId: request.id,
      shopifyDraftOrderGid:
        overrides?.shopifyDraftOrderGid === undefined
          ? DRAFT_GID
          : overrides.shopifyDraftOrderGid,
      invoiceUrl:
        overrides?.invoiceUrl === undefined ? INVOICE_URL : overrides.invoiceUrl,
      lineItemsJson: JSON.stringify([{ title: "Monstera", price: 100, kind: "plant" }]),
      reserveInventoryUntil: new Date(Date.now() - 60 * 60 * 1000),
      voidedAt: overrides?.voidedAt ?? null,
      voidError: overrides?.voidError ?? null,
      voidStartedAt: overrides?.voidStartedAt ?? null,
    },
  });

  return request;
}

const openStatus = {
  draftOrder: {
    id: DRAFT_GID,
    status: "INVOICE_SENT",
    invoiceUrl: INVOICE_URL,
    order: null,
  },
};

const deleted = {
  draftOrderDelete: {
    deletedId: DRAFT_GID,
    userErrors: [],
  },
};

describe("voiding an expired unpaid invoice", () => {
  before(reset);
  after(reset);

  it("deletes an OPEN draft order and records the void", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ300");
    const calls: Call[] = [];
    const outcome = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin(
        {
          PlantRequestDraftOrderStatus: openStatus,
          DeletePlantRequestDraftOrder: deleted,
        },
        calls,
      ),
    );

    assert.equal(outcome, "voided");
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["PlantRequestDraftOrderStatus", "DeletePlantRequestDraftOrder"],
    );
    assert.deepEqual(calls[1].variables, { input: { id: DRAFT_GID } });

    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.ok(draft.voidedAt);
    assert.equal(draft.voidError, null);
    assert.equal(draft.voidAttempts, 1);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: request.id, reason: INVOICE_VOIDED_REASON },
      }),
      1,
    );
  });

  it("treats a draft order Shopify already deleted as a successful void", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ301");
    const calls: Call[] = [];
    const outcome = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin({ PlantRequestDraftOrderStatus: { draftOrder: null } }, calls),
    );

    assert.equal(outcome, "voided");
    assert.equal(calls.length, 1);
    assert.ok(
      !calls.some((call) => call.operation === "DeletePlantRequestDraftOrder"),
    );
    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.ok(draft.voidedAt);
  });

  it("treats draftOrderDelete 'not found' as success", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ302");
    const calls: Call[] = [];
    const outcome = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin(
        {
          PlantRequestDraftOrderStatus: openStatus,
          DeletePlantRequestDraftOrder: {
            draftOrderDelete: {
              deletedId: null,
              userErrors: [{ field: ["id"], message: "Draft order does not exist" }],
            },
          },
        },
        calls,
      ),
    );

    assert.equal(outcome, "voided");
    assert.ok(
      calls.some((call) => call.operation === "DeletePlantRequestDraftOrder"),
    );
    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.ok(draft.voidedAt);
    assert.equal(draft.voidError, null);
  });

  it("does not delete a COMPLETED draft order", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ303");
    const calls: Call[] = [];
    const outcome = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin(
        {
          PlantRequestDraftOrderStatus: {
            draftOrder: {
              id: DRAFT_GID,
              status: "COMPLETED",
              invoiceUrl: INVOICE_URL,
              order: { id: "gid://shopify/Order/1002" },
            },
          },
        },
        calls,
      ),
    );

    assert.equal(outcome, "completed");
    assert.ok(
      !calls.some((call) => call.operation === "DeletePlantRequestDraftOrder"),
    );
    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.equal(draft.voidedAt, null);
    assert.equal(draft.voidError, COMPLETED_BEFORE_VOID);

    const again = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin({}, []),
    );
    assert.equal(again, "completed");
  });

  it("records a failed delete and retries after the claim goes stale", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ304");
    const firstCalls: Call[] = [];
    const first = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin(
        {
          PlantRequestDraftOrderStatus: openStatus,
          DeletePlantRequestDraftOrder: {
            draftOrderDelete: {
              deletedId: null,
              userErrors: [{ field: null, message: "Internal error, try again" }],
            },
          },
        },
        firstCalls,
      ),
    );
    assert.equal(first, "failed");
    const failed = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.equal(failed.voidedAt, null);
    assert.match(failed.voidError ?? "", /Internal error/);
    assert.equal(failed.voidAttempts, 1);

    const retryCalls: Call[] = [];
    const retry = await voidExpiredDraftOrder(
      merchantShop,
      request.id,
      fakeAdmin(
        {
          PlantRequestDraftOrderStatus: openStatus,
          DeletePlantRequestDraftOrder: deleted,
        },
        retryCalls,
      ),
      new Date(Date.now() + VOID_CLAIM_MS + 1000),
    );
    assert.equal(retry, "voided");
    assert.ok(
      retryCalls.some((call) => call.operation === "DeletePlantRequestDraftOrder"),
    );
    const voided = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.ok(voided.voidedAt);
    assert.equal(voided.voidAttempts, 2);
  });

  it("skips a request that is not expired, already paid, or already voided", async () => {
    const pending = await seedExpiredWithDraft(merchantShop, "REQ305", {
      status: "Pending",
    });
    const paid = await seedExpiredWithDraft(merchantShop, "REQ306", {
      paidAt: new Date(),
    });
    const voided = await seedExpiredWithDraft(merchantShop, "REQ307", {
      voidedAt: new Date(),
    });
    const calls: Call[] = [];
    const admin = fakeAdmin({}, calls);

    assert.equal(await voidExpiredDraftOrder(merchantShop, pending.id, admin), "skipped");
    assert.equal(await voidExpiredDraftOrder(merchantShop, paid.id, admin), "skipped");
    assert.equal(
      await voidExpiredDraftOrder(merchantShop, voided.id, admin),
      "already_voided",
    );
    assert.equal(calls.length, 0);
  });

  it("marks a demo-shop invoice voided without an Admin client", async () => {
    const request = await seedExpiredWithDraft(demoShop, "REQ308");
    assert.equal(await voidExpiredDraftOrder(demoShop, request.id, undefined), "voided");
    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.ok(draft.voidedAt);
  });

  it("refuses to pretend a merchant invoice was voided without an Admin client", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ309");
    assert.equal(
      await voidExpiredDraftOrder(merchantShop, request.id, undefined),
      "failed",
    );
    const draft = await prisma.draftOrderReference.findUniqueOrThrow({
      where: { requestId: request.id },
    });
    assert.equal(draft.voidedAt, null);
    assert.match(draft.voidError ?? "", /No Admin API client/);
  });
});

describe("overlapping void sweeps", () => {
  before(reset);
  after(reset);

  it("deletes the draft order once when two sweeps run at once", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ310");
    const calls: Call[] = [];
    let deletes = 0;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        const operation = query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
        calls.push({ operation, variables: options?.variables ?? {} });
        if (operation === "PlantRequestDraftOrderStatus") {
          return { json: async () => ({ data: openStatus }) };
        }
        if (operation === "DeletePlantRequestDraftOrder") {
          deletes += 1;
          return { json: async () => ({ data: deleted }) };
        }
        throw new Error(`unexpected Shopify operation ${operation}`);
      },
    } as unknown as GraphqlClient;

    const outcomes = await Promise.all([
      voidExpiredDraftOrders(merchantShop, admin),
      voidExpiredDraftOrders(merchantShop, admin),
    ]);

    assert.equal(deletes, 1, "exactly one sweep may delete the draft order");
    assert.equal(
      outcomes.reduce((sum, row) => sum + row.voided, 0),
      1,
    );
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: request.id, reason: INVOICE_VOIDED_REASON },
      }),
      1,
    );
  });
});

describe("payment arriving after a void", () => {
  before(reset);
  after(reset);

  it("records the money and writes Payment After Expiration/Void", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ311", {
      voidedAt: new Date(),
    });

    const paid = await markRequestPaid(merchantShop, request.id, {
      shopifyOrderGid: "gid://shopify/Order/311",
      orderNumber: "#1002",
      plantRevenue: 100,
    });

    assert.equal(paid?.status, "Closed");
    assert.ok(paid?.paidAt);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: request.id, reason: PAYMENT_AFTER_VOID_REASON },
      }),
      1,
    );
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: request.id, reason: "Payment completed" },
      }),
      0,
    );
    assert.equal(
      await prisma.shopifyOrderReference.count({ where: { requestId: request.id } }),
      1,
    );
  });

  it("uses the same event when the request is Expired and not yet voided", async () => {
    const request = await seedExpiredWithDraft(merchantShop, "REQ312");
    await markRequestPaid(merchantShop, request.id, {
      shopifyOrderGid: "gid://shopify/Order/312",
      orderNumber: "#1003",
      plantRevenue: 100,
    });
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: request.id, reason: PAYMENT_AFTER_VOID_REASON },
      }),
      1,
    );
  });
});
