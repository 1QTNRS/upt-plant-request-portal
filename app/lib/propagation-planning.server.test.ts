import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import {
  action as propagationAction,
  loader as propagationLoader,
} from "../routes/api.mobile.admin.propagation-planning";
import { createAdminMobileToken } from "./admin-mobile-auth.server";
import { canonicalPlantKey } from "./plant-identity";
import type { UnavailableReason } from "./portal";
import {
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-propagation-planning`;
const otherShop = `${DEMO_SHOP}-propagation-planning-other`;

function loaderArgs(request: Request): LoaderFunctionArgs {
  return { request, params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(request: Request): ActionFunctionArgs {
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

function authed(token: string, url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function createNotAvailableOffer(input?: {
  plantName?: string;
  reason?: UnavailableReason;
  customerFacingNotes?: string;
  customerNotes?: string;
}) {
  const created = await submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [
      {
        plantName: input?.plantName ?? "Hoya sp. XYZ",
        notes: input?.customerNotes ?? "Looking for a larger leaf clone.",
      },
    ],
  });
  const item = created.items[0];
  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: item.id,
    offeredName: item.plantName,
    availability: "not_available",
    unavailableReason: input?.reason ?? "currently not in UPT prop circulation",
    customerFacingNotes: input?.customerFacingNotes ?? "Mother plant needs more time.",
    price: 0,
    weightLbs: 0,
  });
  await sendOffer(shop, created.id, 5);
  return { request: created, item };
}

describe("propagation planning mobile API", () => {
  let token = "";
  let otherToken = "";

  before(async () => {
    await prisma.plantRequest.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.propagationPlanningState.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.adminMobileToken.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.shopSettings.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.requestNumberSequence.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    token = (await createAdminMobileToken(shop, "test")).token;
    otherToken = (await createAdminMobileToken(otherShop, "other")).token;
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.propagationPlanningState.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.adminMobileToken.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.shopSettings.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
    await prisma.requestNumberSequence.deleteMany({
      where: { shop: { in: [shop, otherShop] } },
    });
  });

  it("includes only sent offer snapshots marked not_available", async () => {
    const sent = await createNotAvailableOffer();
    const unsent = await submitCustomerRequest(shop, {
      name: "Jamie Lee",
      email: "jamie@example.com",
      items: [{ plantName: "Unsent NA" }],
    });
    await updateRequestItem(shop, {
      requestId: unsent.id,
      itemId: unsent.items[0].id,
      offeredName: "Unsent NA",
      availability: "not_available",
      unavailableReason: "not in our current inventory",
      price: 0,
      weightLbs: 0,
    });

    const declinedRequest = await submitCustomerRequest(shop, {
      name: "Casey Kim",
      email: "casey@example.com",
      items: [{ plantName: "Thai Constellation" }],
    });
    const declinedItem = declinedRequest.items[0];
    await updateRequestItem(shop, {
      requestId: declinedRequest.id,
      itemId: declinedItem.id,
      offeredName: "Thai Constellation Exact",
      availability: "available",
      price: 175,
      weightLbs: 9.5,
      photoUrls: ["https://picsum.photos/seed/thai-prop/800/800"],
    });
    await sendOffer(shop, declinedRequest.id, 5);
    await saveCustomerResponse(shop, {
      requestId: declinedRequest.id,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: 15,
      items: [
        {
          offerItemId: "a",
          sourceItemId: declinedItem.id,
          plantName: "Thai Constellation Exact",
          choice: "reject",
          fulfillmentType: "exact_plant",
          price: 175,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "",
          photoUrls: ["https://picsum.photos/seed/thai-prop/800/800"],
        },
      ],
    });

    const response = await propagationLoader(
      loaderArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning"),
      ),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      tabs: Array<{ plants: Array<{ displayName: string }> }>;
    };
    const plants = payload.tabs.flatMap((tab) =>
      tab.plants.map((row) => row.displayName),
    );
    assert.ok(plants.some((name) => name.includes("Hoya") || name === sent.item.plantName));
    assert.ok(!plants.includes("Unsent NA"));
    assert.ok(!plants.some((name) => name.includes("Thai Constellation Exact")));
  });

  async function groupKeyForPlant(plantName: string): Promise<string> {
    const response = await propagationLoader(
      loaderArgs(
        authed(
          token,
          "https://app.example/api/mobile/admin/propagation-planning?status=all",
        ),
      ),
    );
    const payload = (await response.json()) as {
      tabs: Array<{ plants: Array<{ groupKey: string; displayName: string }> }>;
    };
    const group = payload.tabs
      .flatMap((tab) => tab.plants)
      .find((row) => row.displayName === plantName || row.displayName.includes(plantName));
    assert.ok(group, `missing group for ${plantName}`);
    return group.groupKey;
  }

  it("marks done, persists notes, and reports new requests since done", async () => {
    await createNotAvailableOffer({ plantName: "Monstera dubia" });
    const groupKey = await groupKeyForPlant("Monstera dubia");

    const markDone = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "set-done", groupKey }),
        }),
      ),
    );
    assert.equal(markDone.status, 200);

    await createNotAvailableOffer({ plantName: "Monstera dubia" });
    await createNotAvailableOffer({ plantName: "Monstera dubia" });

    const saveNotes = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({
            intent: "save-notes",
            groupKey,
            propNotes: "Mother plant recovering.",
          }),
        }),
      ),
    );
    assert.equal(saveNotes.status, 200);

    const response = await propagationLoader(
      loaderArgs(
        authed(
          token,
          "https://app.example/api/mobile/admin/propagation-planning?status=all",
        ),
      ),
    );
    const payload = (await response.json()) as {
      tabs: Array<{
        plants: Array<{
          groupKey: string;
          state: { done: boolean; propNotes: string };
          newSinceDone: number;
        }>;
      }>;
    };
    const group = payload.tabs
      .flatMap((tab) => tab.plants)
      .find((row) => row.groupKey === groupKey);
    assert.equal(group?.state.done, true);
    assert.equal(group?.state.propNotes, "Mother plant recovering.");
    assert.ok((group?.newSinceDone ?? 0) >= 2);

    const undo = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "undo-done", groupKey }),
        }),
      ),
    );
    assert.equal(undo.status, 200);
  });

  it("rejects invalid group keys and cross-shop mutations", async () => {
    await createNotAvailableOffer({ plantName: "Syngonium podophyllum" });
    const groupKey = await groupKeyForPlant("Syngonium podophyllum");

    const invalid = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "set-done", groupKey: "c:missing" }),
        }),
      ),
    );
    assert.equal(invalid.status, 400);

    const crossShop = await propagationAction(
      actionArgs(
        authed(otherToken, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "set-done", groupKey }),
        }),
      ),
    );
    assert.equal(crossShop.status, 400);
  });

  it("keeps alias planning state after canonical identity is linked", async () => {
    const plantName = "Hoya sp. AH-021";
    await createNotAvailableOffer({ plantName });
    const groupKeyBeforeLink = await groupKeyForPlant(plantName);

    await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({
            intent: "save-notes",
            groupKey: groupKeyBeforeLink,
            propNotes: "Keep this note after linking.",
          }),
        }),
      ),
    );

    const item = await prisma.requestItem.findFirst({
      where: { plantName, request: { shop } },
    });
    assert.ok(item);
    const canonical =
      (await prisma.canonicalPlant.findUnique({
        where: {
          shop_canonicalKey: { shop, canonicalKey: canonicalPlantKey(plantName) },
        },
      })) ??
      (await prisma.canonicalPlant.create({
        data: {
          shop,
          canonicalKey: canonicalPlantKey(plantName),
          displayName: plantName,
        },
      }));
    await prisma.plantNameAlias.upsert({
      where: {
        shop_aliasKey: { shop, aliasKey: canonicalPlantKey(plantName) },
      },
      create: {
        shop,
        aliasKey: canonicalPlantKey(plantName),
        originalName: plantName,
        canonicalPlantId: canonical.id,
        source: "admin_confirmed",
      },
      update: { canonicalPlantId: canonical.id },
    });
    await prisma.requestItem.update({
      where: { id: item.id },
      data: { canonicalPlantId: canonical.id },
    });

    const response = await propagationLoader(
      loaderArgs(
        authed(
          token,
          "https://app.example/api/mobile/admin/propagation-planning?status=all",
        ),
      ),
    );
    const payload = (await response.json()) as {
      tabs: Array<{ plants: Array<{ groupKey: string; state: { propNotes: string } }> }>;
    };
    const canonicalGroup = payload.tabs
      .flatMap((tab) => tab.plants)
      .find((row) => row.groupKey === `c:${canonical.id}`);
    assert.equal(canonicalGroup?.state.propNotes, "Keep this note after linking.");
  });

  it("closes and reopens a plant while preserving notes and done history", async () => {
    await createNotAvailableOffer({ plantName: "Dischidia ovata" });
    const groupKey = await groupKeyForPlant("Dischidia ovata");

    await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "set-done", groupKey }),
        }),
      ),
    );

    await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({
            intent: "save-notes",
            groupKey,
            propNotes: "Not worth sourcing.",
          }),
        }),
      ),
    );

    const close = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "close", groupKey }),
        }),
      ),
    );
    assert.equal(close.status, 200);

    const activeResponse = await propagationLoader(
      loaderArgs(
        authed(
          token,
          "https://app.example/api/mobile/admin/propagation-planning?status=active",
        ),
      ),
    );
    const activePayload = (await activeResponse.json()) as {
      tabs: Array<{ plants: Array<{ groupKey: string }> }>;
    };
    assert.ok(
      !activePayload.tabs
        .flatMap((tab) => tab.plants)
        .some((row) => row.groupKey === groupKey),
    );

    const closedResponse = await propagationLoader(
      loaderArgs(
        authed(
          token,
          "https://app.example/api/mobile/admin/propagation-planning?status=closed",
        ),
      ),
    );
    const closedPayload = (await closedResponse.json()) as {
      tabs: Array<{
        plants: Array<{
          groupKey: string;
          state: { closed: boolean; done: boolean; propNotes: string; closedAtIso: string | null };
        }>;
      }>;
    };
    const closedGroup = closedPayload.tabs
      .flatMap((tab) => tab.plants)
      .find((row) => row.groupKey === groupKey);
    assert.equal(closedGroup?.state.closed, true);
    assert.equal(closedGroup?.state.done, true);
    assert.equal(closedGroup?.state.propNotes, "Not worth sourcing.");
    assert.ok(closedGroup?.state.closedAtIso);

    const reopen = await propagationAction(
      actionArgs(
        authed(token, "https://app.example/api/mobile/admin/propagation-planning", {
          method: "POST",
          body: JSON.stringify({ intent: "reopen", groupKey }),
        }),
      ),
    );
    assert.equal(reopen.status, 200);

    const row = await prisma.propagationPlanningState.findUnique({
      where: { shop_groupKey: { shop, groupKey } },
    });
    assert.equal(row?.closedAt, null);
    assert.ok(row?.completedAt);
    assert.equal(row?.propNotes, "Not worth sourcing.");
  });
});
