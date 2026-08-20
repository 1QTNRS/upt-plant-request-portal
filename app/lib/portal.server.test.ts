import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { DEMO_SHOP } from "./shop";
import {
  closeRequest,
  getCustomerResponse,
  getRequest,
  listCustomerRequests,
  listRequests,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { ensureShopSeeded } from "./seed-demo.server";
import { matchesAdminSearch } from "./portal";

const shop = `${DEMO_SHOP}-test`;

describe("plant request persistence", () => {
  before(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
    await ensureShopSeeded(shop);
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  });

  it("seeds dashboard requests and supports admin search", async () => {
    const requests = await listRequests(shop);
    assert.ok(requests.length >= 6);
    const sarah = requests.find((request) => request.customer === "Sarah Mitchell");
    assert.ok(sarah);
    assert.equal(
      matchesAdminSearch(
        {
          customer: sarah.customer,
          requestNumber: sarah.requestNumber,
          items: sarah.items,
        },
        "monstera",
      ),
      true,
    );
  });

  it("keeps customer requests private by account identity", async () => {
    const alex = await listCustomerRequests(shop, {
      email: "alex.rivera@example.com",
    });
    const emily = await listCustomerRequests(shop, {
      email: "emily.r@email.com",
    });
    assert.ok(alex.every((request) => request.email === "alex.rivera@example.com"));
    assert.ok(emily.every((request) => request.email === "emily.r@email.com"));
    assert.equal(
      alex.some((request) => request.email === "emily.r@email.com"),
      false,
    );
  });

  it("submits a multi-plant request, sends an offer snapshot, and records customer choices", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [
        { plantName: "Monstera Peru", notes: "Climbing" },
        { plantName: "Ghost Plant" },
      ],
    });

    assert.match(created.requestNumber, /^UPT-REQ-\d{4}-\d{6}$/);
    assert.equal(created.status, "New");
    assert.equal(created.items.length, 2);
    assert.equal(created.items[0]?.quantity, 1);
    assert.equal(created.items[0]?.adminNotes, "Climbing");
    assert.equal(created.items[0]?.budget, undefined);

    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      offeredName: "Monstera Peru Exact",
      price: 92,
      weightLbs: 6.5,
      customerFacingNotes: "Newest leaf is healthy.",
      availability: "available",
    });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[1].id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
      customerFacingNotes: "Not currently in inventory.",
    });

    const offered = await sendOffer(shop, created.id, 5);
    assert.equal(offered?.status, "Pending");
    assert.equal(offered?.sentOffer?.expirationDays, 5);

    const afterOfferEdit = await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      price: 1,
    }).catch((error: Error) => error);
    assert.ok(afterOfferEdit instanceof Error);

    await saveCustomerResponse(shop, {
      requestId: created.id,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: 15,
      items: [
        {
          offerItemId: "a",
          sourceItemId: created.items[0].id,
          plantName: "Monstera Peru Exact",
          choice: "accept",
          price: 92,
          quantity: 1,
          lineRevenue: 92,
          customerNotes: "Newest leaf is healthy.",
          photoUrls: [],
        },
        {
          offerItemId: "b",
          sourceItemId: created.items[1].id,
          plantName: "Ghost Plant",
          choice: "unavailable",
          price: 0,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "Not currently in inventory.",
          photoUrls: [],
          unavailableReason: "not in our current inventory",
        },
      ],
    });

    const response = await getCustomerResponse(shop, created.id);
    assert.equal(response?.fedexUpgradeSelected, false);
    assert.equal(response?.items.filter((item) => item.choice === "accept").length, 1);

    const closed = await closeRequest(shop, created.id, "Customer closed request");
    assert.equal(closed?.status, "Closed");
    const reloaded = await getRequest(shop, created.id);
    assert.ok(reloaded?.closedAt);
  });
});
