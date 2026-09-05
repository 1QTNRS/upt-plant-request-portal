import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { action as listingAction, loader as reviewLoader } from "../routes/api.mobile.admin.exact-plants.$itemId";
import { loader as queueLoader } from "../routes/api.mobile.admin.exact-plants._index";
import { action as settingsAction, loader as settingsLoader } from "../routes/api.mobile.admin.settings";
import { createAdminMobileToken } from "./admin-mobile-auth.server";
import { DEFAULT_FEDEX_REMOVAL_WARNING } from "./portal";
import {
  markRequestPaid,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-mobile-exact-plants`;

function loaderArgs(request: Request, params: Record<string, string> = {}): LoaderFunctionArgs {
  return { request, params, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(request: Request, params: Record<string, string> = {}): ActionFunctionArgs {
  return { request, params, context: {} } as unknown as ActionFunctionArgs;
}

function authed(token: string, url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function createDeclinedExactPlant() {
  const created = await submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [{ plantName: "Thai Constellation", notes: "Climbing" }],
  });
  const item = created.items[0];
  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: item.id,
    offeredName: "Thai Constellation Exact",
    price: 175,
    weightLbs: 9.5,
    availability: "available",
    photoUrls: ["https://picsum.photos/seed/thai-mobile/800/800"],
  });
  await sendOffer(shop, created.id, 5);
  await saveCustomerResponse(shop, {
    requestId: created.id,
    fedexUpgradeSelected: false,
    fedexUpgradePrice: 15,
    items: [
      {
        offerItemId: "a",
        sourceItemId: item.id,
        plantName: "Thai Constellation Exact",
        choice: "reject",
        fulfillmentType: "exact_plant",
        price: 175,
        quantity: 1,
        lineRevenue: 0,
        customerNotes: "",
        photoUrls: ["https://picsum.photos/seed/thai-mobile/800/800"],
      },
    ],
  });
  return { request: created, itemId: item.id };
}

describe("admin mobile EXACT PLANTS and settings", () => {
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

  it("refuses the queue, review, and settings without a bearer token", async () => {
    const queue = await queueLoader(
      loaderArgs(new Request("https://app.example/api/mobile/admin/exact-plants")),
    );
    const review = await reviewLoader(
      loaderArgs(new Request("https://app.example/api/mobile/admin/exact-plants/x"), {
        itemId: "x",
      }),
    );
    const settings = await settingsLoader(
      loaderArgs(new Request("https://app.example/api/mobile/admin/settings")),
    );
    assert.equal(queue.status, 401);
    assert.equal(review.status, 401);
    assert.equal(settings.status, 401);
  });

  it("lists, reviews, and dismisses through the same exact-plants functions as the website", async () => {
    const { itemId } = await createDeclinedExactPlant();
    const token = (await createAdminMobileToken(shop, "iPhone")).token;

    const queue = await queueLoader(
      loaderArgs(
        authed(token, "https://app.example/api/mobile/admin/exact-plants?listing=not_yet_listed"),
      ),
    );
    assert.equal(queue.status, 200);
    const queueBody = (await queue.json()) as {
      items: Array<{ requestItemId: string; canDismiss: boolean; title: string }>;
    };
    assert.equal(queueBody.items.some((row) => row.requestItemId === itemId), true);
    const row = queueBody.items.find((entry) => entry.requestItemId === itemId);
    assert.equal(row?.canDismiss, true);
    assert.equal(row?.title, "Thai Constellation Exact");

    const review = await reviewLoader(
      loaderArgs(
        authed(token, `https://app.example/api/mobile/admin/exact-plants/${itemId}`),
        { itemId },
      ),
    );
    assert.equal(review.status, 200);
    const reviewBody = (await review.json()) as {
      draft: { title: string; price: number };
      canDismiss: boolean;
      listed: boolean;
    };
    assert.equal(reviewBody.draft.title, "Thai Constellation Exact");
    assert.equal(reviewBody.draft.price, 175);
    assert.equal(reviewBody.canDismiss, true);
    assert.equal(reviewBody.listed, false);

    const unconfirmed = await listingAction(
      actionArgs(
        authed(token, `https://app.example/api/mobile/admin/exact-plants/${itemId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "dismiss-exact-plant" }),
        }),
        { itemId },
      ),
    );
    const unconfirmedBody = (await unconfirmed.json()) as {
      ok: boolean;
      pendingDismiss?: boolean;
    };
    assert.equal(unconfirmedBody.ok, false);
    assert.equal(unconfirmedBody.pendingDismiss, true);

    const dismissed = await listingAction(
      actionArgs(
        authed(token, `https://app.example/api/mobile/admin/exact-plants/${itemId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "dismiss-exact-plant",
            confirmed: "true",
          }),
        }),
        { itemId },
      ),
    );
    assert.equal(((await dismissed.json()) as { ok: boolean }).ok, true);

    const after = await queueLoader(
      loaderArgs(
        authed(token, "https://app.example/api/mobile/admin/exact-plants?listing=dismissed"),
      ),
    );
    const afterBody = (await after.json()) as {
      items: Array<{ requestItemId: string; canList: boolean }>;
    };
    assert.equal(afterBody.items.some((row) => row.requestItemId === itemId), true);
    assert.equal(
      afterBody.items.find((row) => row.requestItemId === itemId)?.canList,
      false,
    );
  });

  it("approves a listing through createExactPlantListing", async () => {
    const { itemId } = await createDeclinedExactPlant();
    const token = (await createAdminMobileToken(shop, "Approve phone")).token;

    const created = await listingAction(
      actionArgs(
        authed(token, `https://app.example/api/mobile/admin/exact-plants/${itemId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "create-listing",
            title: "Thai Constellation Exact",
            price: 175,
            weightLbs: 9.5,
            photoUrls: ["https://picsum.photos/seed/thai-mobile/800/800"],
          }),
        }),
        { itemId },
      ),
    );
    const body = (await created.json()) as {
      ok: boolean;
      listed?: boolean;
      review?: { listed: boolean };
      error?: string;
    };
    assert.equal(body.ok, true, body.error);
    assert.equal(body.listed, true);
    assert.equal(body.review?.listed, true);
  });

  it("reads and saves FedEx warning settings on the phone", async () => {
    const token = (await createAdminMobileToken(shop, "Settings phone")).token;
    await updateShopSettings(shop, {
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
      adminNotificationEmail: "old@example.com",
    });

    const loaded = await settingsLoader(
      loaderArgs(authed(token, "https://app.example/api/mobile/admin/settings")),
    );
    const loadedBody = (await loaded.json()) as {
      fedexRemovalWarning: string;
      adminNotificationEmail: string;
    };
    assert.equal(loadedBody.fedexRemovalWarning, DEFAULT_FEDEX_REMOVAL_WARNING);
    assert.equal(loadedBody.adminNotificationEmail, "old@example.com");

    const saved = await settingsAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "save",
            fedexRemovalWarning: "Phone-updated warning.",
            adminNotificationEmail: "phone@example.com",
            adminEmailNewRequest: false,
          }),
        }),
      ),
    );
    const savedBody = (await saved.json()) as {
      ok: boolean;
      fedexRemovalWarning: string;
      adminNotificationEmail: string;
      adminEmailNewRequest: boolean;
    };
    assert.equal(savedBody.ok, true);
    assert.equal(savedBody.fedexRemovalWarning, "Phone-updated warning.");
    assert.equal(savedBody.adminNotificationEmail, "phone@example.com");
    assert.equal(savedBody.adminEmailNewRequest, false);

    const reset = await settingsAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "reset" }),
        }),
      ),
    );
    const resetBody = (await reset.json()) as {
      reset: boolean;
      fedexRemovalWarning: string;
    };
    assert.equal(resetBody.reset, true);
    assert.equal(resetBody.fedexRemovalWarning, DEFAULT_FEDEX_REMOVAL_WARNING);
  });

  it("keeps a declined Exact Plant in Not listed after a sibling is paid", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Declined exact" }, { plantName: "Accepted sibling" }],
    });
    const [declined, accepted] = created.items;
    for (const item of created.items) {
      await updateRequestItem(shop, {
        requestId: created.id,
        itemId: item.id,
        offeredName: item.plantName,
        price: 80,
        weightLbs: 2,
        availability: "available",
        photoUrls: [`https://picsum.photos/seed/${item.id}/800/800`],
      });
    }
    await sendOffer(shop, created.id, 3);
    await saveCustomerResponse(shop, {
      requestId: created.id,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: 15,
      items: [
        {
          offerItemId: "declined",
          sourceItemId: declined.id,
          plantName: declined.plantName,
          choice: "reject",
          fulfillmentType: "exact_plant",
          price: 80,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "",
          photoUrls: [],
        },
        {
          offerItemId: "accepted",
          sourceItemId: accepted.id,
          plantName: accepted.plantName,
          choice: "accept",
          fulfillmentType: "exact_plant",
          price: 80,
          quantity: 1,
          lineRevenue: 80,
          customerNotes: "",
          photoUrls: [],
        },
      ],
    });
    await markRequestPaid(shop, created.id, {
      shopifyOrderGid: "gid://shopify/Order/mobile-sibling",
      orderNumber: "#M1",
      plantRevenue: 80,
    });

    const token = (await createAdminMobileToken(shop, "iPhone sibling")).token;
    const queue = await queueLoader(
      loaderArgs(
        authed(token, "https://app.example/api/mobile/admin/exact-plants?listing=not_yet_listed"),
      ),
    );
    const body = (await queue.json()) as {
      items: Array<{ requestItemId: string; listingStatus: string }>;
    };
    assert.equal(body.items.some((row) => row.requestItemId === declined.id), true);
    assert.equal(body.items.some((row) => row.requestItemId === accepted.id), false);
    assert.equal(
      body.items.find((row) => row.requestItemId === declined.id)?.listingStatus,
      "not_yet_listed",
    );
  });
});
