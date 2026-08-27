import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { action as requestAction } from "../routes/api.mobile.admin.requests.$id";
import {
  handleMobileAdminRequestAction,
  loadMobileAdminRequestDetail,
} from "./admin-mobile-actions.server";
import { createAdminMobileToken } from "./admin-mobile-auth.server";
import { submitCustomerRequest, updateRequestItem } from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-mobile-actions`;

function actionArgs(request: Request, id: string): ActionFunctionArgs {
  return { request, params: { id }, context: {} } as unknown as ActionFunctionArgs;
}

async function jsonAction(
  token: string,
  requestId: string,
  body: Record<string, unknown>,
) {
  const request = new Request(
    `https://app.example/api/mobile/admin/requests/${requestId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return requestAction(actionArgs(request, requestId));
}

describe("admin mobile request actions", () => {
  before(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
  });

  it("refuses an action without a bearer token", async () => {
    const response = await requestAction(
      actionArgs(
        new Request("https://app.example/api/mobile/admin/requests/x", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "send-offer" }),
        }),
        "x",
      ),
    );
    assert.equal(response.status, 401);
  });

  it("edits an item, adds a photo, and sends an offer through the same functions as the web admin", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Monstera Peru", notes: "Climbing" }],
    });
    const token = (await createAdminMobileToken(shop, "iPhone")).token;

    const priced = await jsonAction(token, created.id, {
      intent: "update-item",
      itemId: created.items[0].id,
      offeredName: "Monstera Peru Exact",
      availability: "available",
      fulfillmentType: "exact_plant",
      price: 92,
      weightLbs: 6.5,
      customerFacingNotes: "Newest leaf is healthy.",
    });
    assert.equal(priced.status, 200);
    const pricedBody = (await priced.json()) as {
      ok: boolean;
      request: { canSendOffer: boolean; items: Array<{ price: number }> };
    };
    assert.equal(pricedBody.ok, true);
    assert.equal(pricedBody.request.items[0].price, 92);
    assert.equal(pricedBody.request.canSendOffer, false);

    const photo = await jsonAction(token, created.id, {
      intent: "add-photo-url",
      itemId: created.items[0].id,
      photoUrl: "https://cdn.example.com/monstera-peru.jpg",
    });
    const photoBody = (await photo.json()) as {
      ok: boolean;
      request: { canSendOffer: boolean; items: Array<{ photos: Array<{ url: string }> }> };
    };
    assert.equal(photoBody.ok, true);
    assert.equal(photoBody.request.canSendOffer, true);
    assert.equal(
      photoBody.request.items[0].photos[0]?.url,
      "https://cdn.example.com/monstera-peru.jpg",
    );

    const incomplete = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "send-offer", expirationDays: 3 },
    });
    // Already complete after the photo; send should succeed.
    assert.equal(incomplete.ok, true);
    assert.equal(incomplete.sent, true);
    assert.equal(incomplete.request?.status, "Pending");
    assert.equal(incomplete.request?.canEditItems, false);
    assert.equal(incomplete.request?.sentOffer?.expirationDays, 3);
    assert.equal(incomplete.request?.sentOffer?.shippingFeeOverride, undefined);
  });

  it("reorders uploaded photos through the same function as the website", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Philodendron White Princess" }],
    });
    const token = (await createAdminMobileToken(shop, "iPhone")).token;
    const itemId = created.items[0].id;
    await jsonAction(token, created.id, {
      intent: "add-photo-url",
      itemId,
      photoUrl: "https://cdn.example.com/white-princess-a.jpg",
    });
    const second = await jsonAction(token, created.id, {
      intent: "add-photo-url",
      itemId,
      photoUrl: "https://cdn.example.com/white-princess-b.jpg",
    });
    const before = (await second.json()) as {
      request: { items: Array<{ photos: Array<{ id: string; url: string }>; price: number }> };
    };
    const ids = before.request.items[0].photos.map((photo) => photo.id);
    assert.equal(ids.length, 2);

    const reordered = await jsonAction(token, created.id, {
      intent: "reorder-photos",
      itemId,
      photoIds: [ids[1], ids[0]],
    });
    const after = (await reordered.json()) as {
      ok: boolean;
      request: { items: Array<{ photos: Array<{ id: string }>; price: number }> };
    };
    assert.equal(after.ok, true);
    assert.deepEqual(
      after.request.items[0].photos.map((photo) => photo.id),
      [ids[1], ids[0]],
    );
    assert.equal(after.request.items[0].price, before.request.items[0].price);
  });

  it("freezes an ADD ON amount on send-offer the same way the website does", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Anthurium Clarinervium" }],
      hasExistingOrder: true,
    });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      price: 85,
      weightLbs: 4,
      photoUrls: ["https://cdn.example.com/anthurium.jpg"],
    });

    const rejected = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: {
        intent: "send-offer",
        expirationDays: 3,
        shippingFeeOverride: "free",
      },
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error ?? "", /ADD ON/);

    const sent = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: {
        intent: "send-offer",
        expirationDays: 3,
        shippingFeeOverride: "12.50",
      },
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.request?.hasExistingOrder, true);
    assert.equal(sent.request?.sentOffer?.shippingFeeOverride, 12.5);
  });

  it("searches demo stock and links a Grower's Choice listing", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Thai Constellation" }],
    });

    const search = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "search-stock", itemId: created.items[0].id, term: "Thai" },
    });
    assert.equal(search.ok, true);
    const thai = search.stockSearch?.results.find(
      (row) => row.variantGid === "gid://shopify/ProductVariant/demo-monstera-thai-6in",
    );
    assert.ok(thai);
    assert.equal(thai.unlinkableReason, null);
    assert.equal(thai.inventoryQuantity, 4);
    assert.equal(thai.inventoryTracked, true);
    assert.equal(thai.publishedOnOnlineStore, true);

    const zero = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "search-stock", itemId: created.items[0].id, term: "anthurium" },
    });
    assert.equal(zero.ok, true);
    assert.equal(zero.stockSearch?.results.length, 1);
    assert.equal(zero.stockSearch?.results[0].inventoryQuantity, 0);
    assert.match(zero.stockSearch?.results[0].unlinkableReason ?? "", /out of stock/i);

    const refusedZero = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: {
        intent: "link-stock",
        itemId: created.items[0].id,
        variantGid: "gid://shopify/ProductVariant/demo-anthurium-waroq-8in",
      },
    });
    assert.equal(refusedZero.ok, false);
    assert.match(refusedZero.ok ? "" : (refusedZero.error ?? ""), /out of stock/i);

    const draft = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "search-stock", itemId: created.items[0].id, term: "draft" },
    });
    assert.equal(draft.ok, true);
    assert.deepEqual(draft.stockSearch?.results, []);

    const posOnly = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "search-stock", itemId: created.items[0].id, term: "hoya" },
    });
    assert.equal(posOnly.ok, true);
    assert.deepEqual(posOnly.stockSearch?.results, []);

    const linked = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: {
        intent: "link-stock",
        itemId: created.items[0].id,
        variantGid: "gid://shopify/ProductVariant/demo-monstera-thai-6in",
      },
    });
    assert.equal(linked.ok, true);
    assert.equal(linked.request?.items[0].fulfillmentType, "growers_choice");
    assert.equal(
      linked.request?.items[0].linkedStock?.variantGid,
      "gid://shopify/ProductVariant/demo-monstera-thai-6in",
    );
  });

  it("refuses send-offer until the exact plant is complete, then override-closes", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Ghost Plant" }],
    });

    const blocked = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "send-offer" },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /missing/);

    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      price: 40,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/ghost.jpg"],
    });

    const sent = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "send-offer", expirationDays: 5 },
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.request?.status, "Pending");

    const needsConfirm = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "admin-override-close" },
    });
    assert.equal(needsConfirm.ok, false);
    assert.equal(needsConfirm.pendingAdminOverrideClose, true);

    const closed = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "admin-override-close", confirmed: "true" },
    });
    assert.equal(closed.ok, true);
    assert.equal(closed.request?.status, "Closed");
    const detail = await loadMobileAdminRequestDetail(shop, created.id);
    assert.equal(detail?.canOverrideClose, false);
  });

  it("refuses close-request before the customer answers", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Hoya" }],
    });
    const result = await handleMobileAdminRequestAction({
      shop,
      requestId: created.id,
      origin: "https://app.example",
      fields: { intent: "close-request" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /has not answered/);
  });
});
