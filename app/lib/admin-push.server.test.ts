import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import prisma from "../db.server";
import { action as pushTokenAction } from "../routes/api.mobile.admin.push-token";
import {
  notifyAdminResponse,
  notifyNewRequest,
} from "./emails.server";
import {
  createAdminMobileToken,
  revokeAdminMobileToken,
} from "./admin-mobile-auth.server";
import {
  countRegisteredPushDevices,
  notifyItemStatusUpdatePush,
  notifyNewRequestPush,
  registerDeviceExpoPushToken,
  type AdminPushSender,
  type ExpoPushMessage,
} from "./admin-push.server";
import {
  handleCustomerOfferAction,
} from "./offer-response.server";
import {
  getRequest,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-admin-push-test`;
const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbb]";
const TOKEN_C = "ExponentPushToken[cccccccccccccccccccc]";

function recordingSender(outcomes: Array<"ok" | "DeviceNotRegistered" | "fail"> = []): {
  sender: AdminPushSender;
  sent: ExpoPushMessage[];
} {
  const sent: ExpoPushMessage[] = [];
  const sender: AdminPushSender = async (messages) => {
    sent.push(...messages);
    return messages.map((_, index) => {
      const outcome = outcomes[index] ?? "ok";
      if (outcome === "ok") return { status: "ok" as const, id: `ticket-${index}` };
      if (outcome === "DeviceNotRegistered") {
        return {
          status: "error" as const,
          message: "not registered",
          details: { error: "DeviceNotRegistered" },
        };
      }
      return { status: "error" as const, message: "temporary" };
    });
  };
  return { sender, sent };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function requestWithBearer(token: string, body: Record<string, unknown>) {
  return new Request("https://app.example/api/mobile/admin/push-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function purge() {
  await prisma.adminPushMessage.deleteMany({ where: { shop } });
  await prisma.adminMobileToken.deleteMany({ where: { shop } });
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

async function submitRequest(plant = "Monstera Albo") {
  return submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [{ plantName: plant }],
  });
}

async function registerToken(label: string, expoPushToken: string) {
  const created = await createAdminMobileToken(shop, label);
  const result = await registerDeviceExpoPushToken({
    shop,
    tokenId: created.record.id,
    expoPushToken,
  });
  assert.equal(result.ok, true);
  return created;
}

describe("iOS admin push notifications", () => {
  before(purge);
  after(purge);
  beforeEach(async () => {
    await purge();
    await registerToken("Phone A", TOKEN_A);
  });

  it("sends one new-request push when the toggle is on", async () => {
    const created = await submitRequest();
    const { sender, sent } = recordingSender();
    await notifyNewRequest(shop, created.id, { pushSender: sender });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "New plant request");
    assert.equal(sent[0].body, `${created.requestNumber} from Alex Rivera`);
    assert.equal(sent[0].data.requestId, created.id);
    assert.equal(
      await prisma.adminPushMessage.count({
        where: { shop, requestId: created.id, kind: "new_request" },
      }),
      1,
    );
  });

  it("sends no new-request push when the toggle is off", async () => {
    await updateShopSettings(shop, { adminPushNewRequest: false });
    const created = await submitRequest("Philodendron");
    const { sender, sent } = recordingSender();
    await notifyNewRequest(shop, created.id, { pushSender: sender });
    assert.equal(sent.length, 0);
    assert.equal(
      await prisma.adminPushMessage.count({
        where: { shop, requestId: created.id, kind: "new_request" },
      }),
      0,
    );
    await updateShopSettings(shop, { adminPushNewRequest: true });
  });

  it("does not send a duplicate new-request push on retry", async () => {
    const created = await submitRequest("Anthurium");
    const first = recordingSender();
    await notifyNewRequestPush(shop, created.id, { sender: first.sender });
    await notifyNewRequestPush(shop, created.id, { sender: first.sender });
    assert.equal(first.sent.length, 1);
  });

  it("consolidates Accept/Reject into one item-status push", async () => {
    const acceptedOnly = await submitRequest("Hoya");
    const rejectedOnly = await submitRequest("Fern");
    const mixed = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Albo" }, { plantName: "Pink" }, { plantName: "Melon" }],
    });

    const { sender, sent } = recordingSender();
    await notifyItemStatusUpdatePush(shop, {
      requestId: acceptedOnly.id,
      acceptedCount: 2,
      rejectedCount: 0,
      sender,
    });
    await notifyItemStatusUpdatePush(shop, {
      requestId: rejectedOnly.id,
      acceptedCount: 0,
      rejectedCount: 3,
      sender,
    });
    await notifyItemStatusUpdatePush(shop, {
      requestId: mixed.id,
      acceptedCount: 2,
      rejectedCount: 3,
      sender,
    });

    assert.deepEqual(
      sent.map((message) => message.body),
      [
        `${acceptedOnly.requestNumber}: 2 accepted`,
        `${rejectedOnly.requestNumber}: 3 rejected`,
        `${mixed.requestNumber}: 2 accepted, 3 rejected`,
      ],
    );
    assert.equal(sent.length, 3);
  });

  it("sends no item-status push when that toggle is off", async () => {
    await updateShopSettings(shop, { adminPushItemStatusUpdate: false });
    const created = await submitRequest("Begonia");
    const { sender, sent } = recordingSender();
    await notifyAdminResponse(shop, {
      requestId: created.id,
      acceptedCount: 1,
      rejectedCount: 1,
      pushSender: sender,
    });
    assert.equal(sent.length, 0);
    await updateShopSettings(shop, { adminPushItemStatusUpdate: true });
  });

  it("does not duplicate an item-status push after a retry", async () => {
    const created = await submitRequest("Scindapsus");
    const { sender, sent } = recordingSender();
    await notifyItemStatusUpdatePush(shop, {
      requestId: created.id,
      acceptedCount: 1,
      rejectedCount: 0,
      sender,
    });
    await notifyItemStatusUpdatePush(shop, {
      requestId: created.id,
      acceptedCount: 1,
      rejectedCount: 0,
      sender,
    });
    assert.equal(sent.length, 1);
  });

  it("stops pushing to a revoked device and keeps going for others", async () => {
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
    const keep = await registerToken("Keep", TOKEN_B);
    const revoke = await registerToken("Revoke", TOKEN_C);
    await revokeAdminMobileToken(shop, revoke.record.id);
    assert.equal(await countRegisteredPushDevices(shop), 1);

    const created = await submitRequest("Revoked check");
    const { sender, sent } = recordingSender();
    await notifyNewRequestPush(shop, created.id, { sender });
    assert.deepEqual(sent.map((message) => message.to), [TOKEN_B]);
    void keep;
  });

  it("clears an invalid Expo token and still delivers to the other device", async () => {
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
    const good = await registerToken("Good", TOKEN_A);
    const bad = await registerToken("Bad", TOKEN_B);
    const created = await submitRequest("Invalid token");
    const { sender, sent } = recordingSender(["ok", "DeviceNotRegistered"]);
    await notifyNewRequestPush(shop, created.id, { sender });
    assert.equal(sent.length, 2);
    const cleared = await prisma.adminMobileToken.findUnique({
      where: { id: bad.record.id },
    });
    const kept = await prisma.adminMobileToken.findUnique({
      where: { id: good.record.id },
    });
    assert.equal(cleared?.expoPushToken, null);
    assert.equal(kept?.expoPushToken, TOKEN_A);
  });

  it("keeps email preferences independent of push preferences", async () => {
    await updateShopSettings(shop, {
      adminNotificationEmail: "upt-notify@example.com",
      adminEmailNewRequest: false,
      adminPushNewRequest: true,
      adminEmailCustomerResponse: true,
      adminPushItemStatusUpdate: false,
    });
    const created = await submitRequest("Independence");
    const { sender, sent } = recordingSender();
    await notifyNewRequest(shop, created.id, { pushSender: sender });
    await notifyAdminResponse(shop, {
      requestId: created.id,
      acceptedCount: 1,
      rejectedCount: 0,
      pushSender: sender,
    });
    assert.equal(sent.filter((message) => message.title === "New plant request").length, 1);
    assert.equal(sent.filter((message) => message.title === "Item status update").length, 0);
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "admin_new_request" },
      }),
      0,
    );
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId: created.id, templateKey: "admin_response" },
      }),
      1,
    );
    await updateShopSettings(shop, {
      adminEmailNewRequest: true,
      adminPushItemStatusUpdate: true,
    });
  });

  it("rejects an invalid Expo token on the device endpoint", async () => {
    const created = await createAdminMobileToken(shop, "Bad token phone");
    const denied = await pushTokenAction({
      request: requestWithBearer(created.token, { expoPushToken: "secret-token" }),
      params: {},
      context: {},
    } as never);
    assert.equal(denied.status, 400);
    const ok = await pushTokenAction({
      request: requestWithBearer(created.token, { expoPushToken: TOKEN_A }),
      params: {},
      context: {},
    } as never);
    assert.equal(ok.status, 200);
  });

  it("does not stop Accept/Reject when push is off", async () => {
    await updateShopSettings(shop, { adminPushItemStatusUpdate: false });
    const created = await submitRequest("Keep going");
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 40,
      weightLbs: 1,
      photoUrls: ["https://cdn.example.com/keep.jpg"],
    });
    await sendOffer(shop, created.id, 3);
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
    assert.equal((await getRequest(shop, created.id))?.status, "Pending");
    await updateShopSettings(shop, { adminPushItemStatusUpdate: true });
  });
});

describe("the Settings page separates email and iOS push", () => {
  it("exposes two independent push toggles", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    assert.match(source, /Admin Email Notifications/);
    assert.match(source, /iOS Push Notifications/);
    assert.match(source, /name="adminPushNewRequest"/);
    assert.match(source, /name="adminPushItemStatusUpdate"/);
    assert.match(source, /intent" value="save-admin-push"/);
    assert.match(source, /submittingIntent === "save-admin-push"/);
    assert.match(source, /\{\.\.\.\(savingPush \? \{ loading: true \} : \{\}\)\}/);
    assert.equal(
      (source.match(/navigation\.state !== "idle" \? \{ loading: true \}/g) || []).length,
      0,
    );
  });
});
