import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  TEST_CUSTOMER_CLEANUP_CONFIRM,
  auditTestCustomerCleanup,
  deleteTestCustomerCleanup,
  isValidCleanupConfirmation,
  normalizeCleanupEmail,
  verifyTestCustomerCleanup,
} from "./test-customer-cleanup.server";

const shop = "test-customer-cleanup.myshopify.com";
const email = "aprilbalaga@yahoo.com";

async function purge() {
  await prisma.adminPushMessage.deleteMany({ where: { shop } });
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

async function seedRequest(requestNumber: string) {
  const customer = await prisma.customerProfile.create({
    data: {
      shop,
      name: "April Test",
      email: normalizeCleanupEmail(email),
    },
  });

  const request = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      status: "Closed",
      items: {
        create: {
          plantName: "Test Plant",
          offeredName: "Test Plant",
          availability: "available",
          price: 25,
          weightLbs: 1,
        },
      },
      statusEvents: {
        create: { toStatus: "Closed", reason: "Test seed" },
      },
      internalNotes: {
        create: { shop, body: "internal note" },
      },
      draftOrder: {
        create: {
          shopifyDraftOrderGid: "gid://shopify/DraftOrder/999001",
          invoiceUrl: "https://example.com/invoice",
          lineItemsJson: "[]",
        },
      },
      shopifyOrder: {
        create: {
          shopifyOrderGid: "gid://shopify/Order/999001",
          orderNumber: "#T999",
          plantRevenue: 25,
        },
      },
    },
    include: { items: true },
  });

  await prisma.offer.create({
    data: {
      requestId: request.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      expirationDays: 3,
      offerLink: "https://example.com/offer",
      items: {
        create: {
          requestItemId: request.items[0]!.id,
          plantName: "Test Plant",
          quantity: 1,
          price: 25,
          weightLbs: 1,
          customerFacingNotes: "",
          availability: "available",
        },
      },
    },
  });

  await prisma.exactPlantListing.create({
    data: {
      shop,
      requestItemId: request.items[0]!.id,
      title: "Test Plant Listing",
      price: 25,
      weightLbs: 1,
      status: "approved",
      shopifyProductGid: "gid://shopify/Product/999001",
      shopifyProductHandle: "test-plant-listing",
    },
  });

  await prisma.emailMessage.create({
    data: {
      shop,
      requestId: request.id,
      toEmail: normalizeCleanupEmail(email),
      subject: "Offer ready",
      bodyText: "body",
      templateKey: "offer_ready",
      idempotencyKey: `offer_ready:${request.id}`,
    },
  });

  await prisma.adminPushMessage.create({
    data: {
      shop,
      requestId: request.id,
      kind: "new_request",
      title: "New request",
      body: "body",
      idempotencyKey: `new_request:${request.id}`,
    },
  });

  return request;
}

describe("test customer cleanup", () => {
  before(async () => {
    await purge();
  });

  after(async () => {
    await purge();
  });

  it("normalizes email and confirmation token", () => {
    assert.equal(normalizeCleanupEmail("  AprilBalaga@Yahoo.COM "), email);
    assert.equal(isValidCleanupConfirmation(TEST_CUSTOMER_CLEANUP_CONFIRM), true);
    assert.equal(isValidCleanupConfirmation("NOPE"), false);
  });

  it("audits all portal rows tied to the email", async () => {
    await purge();
    await seedRequest("REQ-CLEANUP-1");
    const audit = await auditTestCustomerCleanup(shop, email);

    assert.equal(audit.counts.requests, 1);
    assert.equal(audit.requests[0]?.requestNumber, "REQ-CLEANUP-1");
    assert.equal(audit.counts.requestItems, 1);
    assert.equal(audit.counts.exactPlantListings, 1);
    assert.equal(audit.counts.draftOrderReferences, 1);
    assert.equal(audit.counts.shopifyOrderReferences, 1);
    assert.equal(audit.counts.emailMessages, 1);
    assert.equal(audit.counts.adminPushMessages, 1);
    assert.equal(audit.analyticsImpact.purchasedRequestCount, 1);
    assert.equal(audit.analyticsImpact.totalPlantRevenue, 25);
    assert.equal(audit.shopify.completedOrdersRequireManualReview, 1);
    assert.equal(audit.shopify.exactPlantProductsRequireManualReview, 1);
  });

  it("deletes portal data idempotently and verifies zero remnants", async () => {
    await purge();
    const request = await seedRequest("REQ-CLEANUP-2");
    const first = await deleteTestCustomerCleanup(shop, email);
    assert.equal(first.deletedRequests, 1);
    assert.equal(first.deletedEmailMessages, 1);
    assert.equal(first.deletedAdminPushMessages, 1);
    assert.equal(first.deletedCustomerProfiles, 1);

    const verification = await verifyTestCustomerCleanup(shop, email, [
      request.requestNumber,
    ]);
    assert.equal(verification.remainingRequests, 0);

    const second = await deleteTestCustomerCleanup(shop, email);
    assert.equal(second.deletedRequests, 0);

    const emptyAudit = await auditTestCustomerCleanup(shop, email);
    assert.equal(emptyAudit.counts.requests, 0);
  });
});
