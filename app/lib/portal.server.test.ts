import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { DEMO_SHOP } from "./shop";
import {
  addInternalNote,
  addItemPhotos,
  buildCustomerOffer,
  closeRequest,
  getCustomerResponse,
  listInternalNotes,
  getCustomerTimeZone,
  getRequest,
  getShopSettings,
  listCustomerRequests,
  listRequests,
  moveItemPhoto,
  removeItemPhoto,
  reorderItemPhotos,
  saveCustomerResponse,
  saveCustomerTimeZone,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
} from "./portal.server";
import { ensureShopSeeded } from "./seed-demo.server";
import {
  filterAdminDashboardRequests,
  matchesAdminSearch,
  summarizeAdminDashboardStats,
} from "./portal";

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

  it("filters the dashboard list by stored status without changing stat counts", async () => {
    const requests = await listRequests(shop);
    const stats = summarizeAdminDashboardStats(requests);
    const pendingJames = filterAdminDashboardRequests(
      requests,
      "James Chen",
      "Pending",
    );
    assert.ok(pendingJames.length > 0);
    assert.ok(pendingJames.every((request) => request.status === "Pending"));
    assert.ok(
      pendingJames.every((request) => request.customer === "James Chen"),
    );
    assert.equal(
      summarizeAdminDashboardStats(requests).pending,
      stats.pending,
    );
    assert.ok(stats.pending >= pendingJames.length);
    assert.ok(stats.newRequests + stats.pending + stats.closed + stats.expired >= requests.length);
  });

  it("filters New seed requests that said they have an existing order", async () => {
    const requests = await listRequests(shop);
    const existing = filterAdminDashboardRequests(requests, "", "ExistingOrder");
    assert.ok(existing.length >= 1);
    assert.ok(
      existing.every(
        (request) => request.status === "New" && request.hasExistingOrder === true,
      ),
    );
    assert.ok(existing.some((request) => request.requestNumber === "REQ6"));
  });

  it("stores the existing-order answer and a shipping override on the offer", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      shopifyCustomerId: "demo-customer-alex",
      items: [{ plantName: "Monstera Shipping Override" }],
      hasExistingOrder: true,
    });
    assert.equal(created.hasExistingOrder, true);

    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 80,
      weightLbs: 4,
      photoUrls: ["https://cdn.example.com/override.jpg"],
    });
    const offered = await sendOffer(shop, created.id, 3, {
      shippingFeeOverride: 0,
    });
    assert.equal(offered?.sentOffer?.shippingFeeOverride, 0);
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

    assert.match(created.requestNumber, /^REQ\d+$/);
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
      photoUrls: ["https://cdn.example.com/monstera-peru.jpg"],
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
          fulfillmentType: "exact_plant" as const,
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
          fulfillmentType: "exact_plant" as const,
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
    assert.deepEqual(
      response?.items.find((item) => item.choice === "accept")?.photoUrls,
      ["https://cdn.example.com/monstera-peru.jpg"],
    );

    const closed = await closeRequest(shop, created.id, "Customer closed request");
    assert.equal(closed?.status, "Closed");
    const reloaded = await getRequest(shop, created.id);
    assert.ok(reloaded?.closedAt);
  });
});

describe("FedEx upgrade price", () => {
  const fedexShop = `${DEMO_SHOP}-fedex`;

  const reset = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: fedexShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: fedexShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: fedexShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: fedexShop } });
  };

  before(reset);
  after(reset);

  it("is what the offer quotes once the live variant price is stored", async () => {
    // Nothing ever wrote this column, so every offer quoted, emailed and froze
    // the default of 15 while Shopify billed the live variant price.
    assert.equal((await getShopSettings(fedexShop)).fedexUpgradePrice, 15);

    await updateShopSettings(fedexShop, {
      fedexVariantGid: "gid://shopify/ProductVariant/42",
      fedexUpgradePrice: 24.5,
    });
    assert.equal((await getShopSettings(fedexShop)).fedexUpgradePrice, 24.5);

    const request = await submitCustomerRequest(fedexShop, {
      name: "Fedex Tester",
      email: "fedex@example.com",
      items: [{ plantName: "Monstera Peru" }],
    });
    await updateRequestItem(fedexShop, {
      requestId: request.id,
      itemId: request.items[0].id,
      price: 92,
      weightLbs: 2,
      availability: "available",
      photoUrls: ["https://cdn.example.com/monstera-peru.jpg"],
    });
    await sendOffer(fedexShop, request.id, 3);

    const offer = await buildCustomerOffer(fedexShop, request.id);
    assert.equal(offer?.fedexUpgradePrice, 24.5);
  });
});

/**
 * These three all used to read a row and then insert it if it was missing,
 * which races its own unique index the moment two requests arrive together —
 * either from one instance serving concurrent requests, or from the several
 * instances render.yaml allows scaling to.
 */
describe("concurrent writes", () => {
  const raceShop = `${DEMO_SHOP}-race`;

  const reset = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: raceShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: raceShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: raceShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: raceShop } });
  };

  before(reset);
  after(reset);

  it("gives every concurrent submission its own request number", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        submitCustomerRequest(raceShop, {
          name: `Racer ${i}`,
          email: `racer-${i}@example.com`,
          items: [{ plantName: `Plant ${i}` }],
        }),
      ),
    );

    const numbers = created.map((request) => request.requestNumber);
    assert.equal(new Set(numbers).size, numbers.length, `duplicate: ${numbers}`);
  });

  it("does not fail a first-time customer who submits twice at once", async () => {
    // Both submissions find no profile, so both used to insert one and the
    // loser's request was lost to a unique-constraint error.
    const email = "double-clicker@example.com";
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        submitCustomerRequest(raceShop, {
          name: "Double Clicker",
          email,
          items: [{ plantName: `Plant ${i}` }],
        }),
      ),
    );

    const rejected = results.filter((result) => result.status === "rejected");
    assert.deepEqual(
      rejected.map((result) => (result as PromiseRejectedResult).reason?.message),
      [],
    );
    assert.equal(
      await prisma.customerProfile.count({ where: { shop: raceShop, email } }),
      1,
    );
  });

  it("serves the first page load after install from several loaders at once", async () => {
    const freshShop = `${DEMO_SHOP}-first-load`;
    await prisma.shopSettings.deleteMany({ where: { shop: freshShop } });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => getShopSettings(freshShop)),
    );

    const rejected = results.filter((result) => result.status === "rejected");
    assert.deepEqual(
      rejected.map((result) => (result as PromiseRejectedResult).reason?.message),
      [],
    );
    assert.equal(await prisma.shopSettings.count({ where: { shop: freshShop } }), 1);

    await prisma.shopSettings.deleteMany({ where: { shop: freshShop } });
  });
});

describe("availability", () => {
  const availabilityShop = `${DEMO_SHOP}-availability-test`;

  const purge = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: availabilityShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: availabilityShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: availabilityShop } });
    await prisma.requestNumberSequence.deleteMany({
      where: { shop: availabilityShop },
    });
  };

  before(purge);
  after(purge);

  it("forgets the unavailable reason once the plant is available again", async () => {
    const created = await submitCustomerRequest(availabilityShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera Albo" }],
    });
    const itemId = created.items[0].id;

    await updateRequestItem(availabilityShop, {
      requestId: created.id,
      itemId,
      availability: "not_available",
      unavailableReason: "available in 2+ mos",
    });
    assert.equal(
      (await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } }))
        .unavailableReason,
      "available in 2+ mos",
    );

    await updateRequestItem(availabilityShop, {
      requestId: created.id,
      itemId,
      availability: "available",
      price: 92,
      weightLbs: 2,
    });

    const item = await prisma.requestItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    assert.equal(item.availability, "available");
    assert.equal(
      item.unavailableReason,
      null,
      "a stale reason would prefill the next flip to Not Available",
    );
  });

  it("keeps other as a stored unavailable reason", async () => {
    const created = await submitCustomerRequest(availabilityShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "String of Pearls" }],
    });
    const itemId = created.items[0].id;

    await updateRequestItem(availabilityShop, {
      requestId: created.id,
      itemId,
      availability: "not_available",
      unavailableReason: "other",
    });
    assert.equal(
      (await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } }))
        .unavailableReason,
      "other",
    );
  });
});

describe("plants keep the order the customer typed them", () => {
  const orderShop = `${DEMO_SHOP}-ordering-test`;

  const purge = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: orderShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: orderShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: orderShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: orderShop } });
  };

  before(purge);
  after(purge);

  it("returns the same order on every read", async () => {
    const typed = [
      "Monstera Albo",
      "Hoya Callistophylla",
      "Anthurium Warocqueanum",
      "Philodendron Spiritus Sancti",
    ];
    const created = await submitCustomerRequest(orderShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: typed.map((plantName) => ({ plantName })),
    });
    assert.deepEqual(created.items.map((item) => item.plantName), typed);

    // Neither table has a position column, so without an explicit order
    // PostgreSQL is free to return these rows differently each time — which is
    // what the customer's offer page and the admin's request page would show.
    for (let read = 0; read < 5; read += 1) {
      const loaded = await getRequest(orderShop, created.id);
      assert.deepEqual(loaded?.items.map((item) => item.plantName), typed);
    }
  });
});

describe("an offer is refused until every Available plant is complete", () => {
  const readyShop = `${DEMO_SHOP}-offer-readiness-test`;

  const purge = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: readyShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: readyShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: readyShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: readyShop } });
  };

  before(purge);
  after(purge);

  async function request(plantNames: string[]) {
    return submitCustomerRequest(readyShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: plantNames.map((plantName) => ({ plantName })),
    });
  }

  it("names each incomplete item and the fields it lacks", async () => {
    const created = await request(["Monstera Albo", "Hoya Callistophylla"]);
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      offeredName: "Monstera Albo Exact",
      availability: "available",
      price: 250,
      weightLbs: 0,
    });
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[1].id,
      availability: "available",
      price: 70,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/hoya.jpg"],
    });

    await assert.rejects(
      () => sendOffer(readyShop, created.id, 3),
      (error: Error) => {
        assert.match(
          error.message,
          /Monstera Albo Exact is missing an exact plant photo and a weight\./,
        );
        assert.doesNotMatch(error.message, /Hoya/);
        return true;
      },
    );

    // Nothing was committed: the request is still editable.
    const unchanged = await getRequest(readyShop, created.id);
    assert.equal(unchanged?.status, "New");
    assert.equal(unchanged?.sentOffer, undefined);
  });

  it("requires nothing of a Not Available plant", async () => {
    const created = await request(["Monstera Albo", "String of Pearls"]);
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 250,
      weightLbs: 2,
      photoUrls: ["https://cdn.example.com/monstera.jpg"],
    });
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[1].id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });

    const offered = await sendOffer(readyShop, created.id, 3);
    assert.equal(offered?.status, "Pending");
  });

  it("closes immediately when the response has nothing purchasable", async () => {
    const created = await request(["Missing Fern"]);
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });

    const offered = await sendOffer(readyShop, created.id, 3, {
      shippingFeeOverride: 12,
    });
    assert.equal(offered?.status, "Closed");
    assert.ok(offered?.closedAt);
    assert.ok(offered?.sentOffer);
    assert.equal(offered?.sentOffer?.shippingFeeOverride, undefined);
    assert.equal(offered?.items[0].availability, "not_available");
    assert.equal(offered?.items[0].itemStatus, "Unavailable");

    const events = await prisma.statusEvent.findMany({
      where: { requestId: created.id },
      orderBy: { createdAt: "asc" },
    });
    const closed = events.filter((event) => event.toStatus === "Closed");
    assert.equal(closed.length, 1);
    assert.equal(closed[0].fromStatus, "New");
    assert.equal(
      closed[0].reason,
      "Admin response contained no purchasable items",
    );

    const retry = await sendOffer(readyShop, created.id, 5);
    assert.equal(retry, null);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId: created.id, toStatus: "Closed" },
      }),
      1,
    );
    assert.equal((await getRequest(readyShop, created.id))?.status, "Closed");
  });

  it("sends an item that has no customer-facing notes", async () => {
    // Notes are optional. A plant with nothing to disclose is still offerable.
    const created = await request(["Anthurium Warocqueanum"]);
    await updateRequestItem(readyShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 400,
      weightLbs: 3,
      customerFacingNotes: "",
      photoUrls: ["https://cdn.example.com/anthurium.jpg"],
    });

    const offered = await sendOffer(readyShop, created.id, 3);
    assert.equal(offered?.status, "Pending");
    assert.equal(offered?.items[0].customerFacingNotes, "");
  });
});

describe("exact plant photos before the offer is sent", () => {
  const photoShop = `${DEMO_SHOP}-photo-test`;

  const purge = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: photoShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: photoShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: photoShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: photoShop } });
  };

  before(purge);
  after(purge);

  const photosOf = async (requestId: string, itemId: string) => {
    const request = await getRequest(photoShop, requestId);
    return request?.items.find((item) => item.id === itemId)?.photos ?? [];
  };

  it("adds, reorders and removes, and refuses a duplicate", async () => {
    const created = await submitCustomerRequest(photoShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera Albo" }],
    });
    const itemId = created.items[0].id;

    await addItemPhotos(photoShop, created.id, itemId, [
      { url: "https://cdn.example.com/a.jpg" },
      { url: "https://cdn.example.com/b.jpg" },
      { url: "https://cdn.example.com/c.jpg" },
    ]);
    assert.deepEqual(
      (await photosOf(created.id, itemId)).map((photo) => photo.url),
      [
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/b.jpg",
        "https://cdn.example.com/c.jpg",
      ],
    );

    // A re-pasted link or a double-submitted form freezes into the snapshot.
    await addItemPhotos(photoShop, created.id, itemId, [
      { url: "https://cdn.example.com/b.jpg" },
    ]);
    assert.equal((await photosOf(created.id, itemId)).length, 3);

    const [, second] = await photosOf(created.id, itemId);
    await moveItemPhoto(photoShop, created.id, itemId, second.id, "up");
    assert.deepEqual(
      (await photosOf(created.id, itemId)).map((photo) => photo.url),
      [
        "https://cdn.example.com/b.jpg",
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/c.jpg",
      ],
    );

    const first = (await photosOf(created.id, itemId))[0];
    await moveItemPhoto(photoShop, created.id, itemId, first.id, "up");
    assert.equal(
      (await photosOf(created.id, itemId))[0].url,
      "https://cdn.example.com/b.jpg",
      "moving the first photo up is a no-op, not a wrap-around",
    );

    await removeItemPhoto(photoShop, created.id, itemId, first.id);
    const remaining = await photosOf(created.id, itemId);
    assert.deepEqual(remaining.map((photo) => photo.url), [
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/c.jpg",
    ]);

    // Renumbered from zero, so a later move cannot land on a stale gap.
    const rows = await prisma.photoReference.findMany({
      where: { itemId },
      orderBy: { sortOrder: "asc" },
    });
    assert.deepEqual(rows.map((row) => row.sortOrder), [0, 1]);
  });

  it("refuses to change photos once the offer is frozen", async () => {
    const created = await submitCustomerRequest(photoShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Hoya Callistophylla" }],
    });
    const itemId = created.items[0].id;
    await addItemPhotos(photoShop, created.id, itemId, [
      { url: "https://cdn.example.com/frozen.jpg" },
    ]);
    await updateRequestItem(photoShop, {
      requestId: created.id,
      itemId,
      availability: "available",
      price: 100,
      weightLbs: 2,
    });
    await sendOffer(photoShop, created.id, 3);

    const [photo] = await photosOf(created.id, itemId);
    await assert.rejects(
      () => removeItemPhoto(photoShop, created.id, itemId, photo.id),
      /before an offer is sent/,
    );
    await assert.rejects(
      () => moveItemPhoto(photoShop, created.id, itemId, photo.id, "down"),
      /before an offer is sent/,
    );
    await assert.rejects(
      () => reorderItemPhotos(photoShop, created.id, itemId, [photo.id]),
      /before an offer is sent/,
    );
  });

  it("accepts a whole photo ordering and ignores a list that is not a permutation", async () => {
    const created = await submitCustomerRequest(photoShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Philodendron Pink Princess" }],
    });
    const itemId = created.items[0].id;
    await addItemPhotos(photoShop, created.id, itemId, [
      { url: "https://cdn.example.com/1.jpg" },
      { url: "https://cdn.example.com/2.jpg" },
      { url: "https://cdn.example.com/3.jpg" },
    ]);
    const [a, b, c] = await photosOf(created.id, itemId);

    await reorderItemPhotos(photoShop, created.id, itemId, [c.id, a.id, b.id]);
    assert.deepEqual(
      (await photosOf(created.id, itemId)).map((photo) => photo.url),
      [
        "https://cdn.example.com/3.jpg",
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
      ],
    );

    await reorderItemPhotos(photoShop, created.id, itemId, [c.id, a.id]);
    assert.deepEqual(
      (await photosOf(created.id, itemId)).map((photo) => photo.id),
      [c.id, a.id, b.id],
      "a partial list must not drop a photo",
    );
  });

  it("does not reset another item's availability, reason, price, weight or notes", async () => {
    const created = await submitCustomerRequest(photoShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [
        { plantName: "Not Available Plant" },
        { plantName: "Photo Plant" },
      ],
    });
    const [held, photographed] = created.items;

    await updateRequestItem(photoShop, {
      requestId: created.id,
      itemId: held.id,
      availability: "not_available",
      unavailableReason: "currently not in UPT prop circulation",
      price: 85,
      weightLbs: 2.5,
      customerFacingNotes: "Back in spring.",
    });
    await updateRequestItem(photoShop, {
      requestId: created.id,
      itemId: photographed.id,
      availability: "available",
      price: 40,
      weightLbs: 1,
      customerFacingNotes: "Exact plant.",
    });

    await addItemPhotos(photoShop, created.id, photographed.id, [
      { url: "https://cdn.example.com/other.jpg" },
    ]);
    await reorderItemPhotos(photoShop, created.id, photographed.id, [
      (await photosOf(created.id, photographed.id))[0].id,
    ]);

    const after = await getRequest(photoShop, created.id);
    const stillHeld = after?.items.find((item) => item.id === held.id);
    const stillPhoto = after?.items.find((item) => item.id === photographed.id);
    assert.equal(stillHeld?.availability, "not_available");
    assert.equal(stillHeld?.fulfillmentType, "not_available");
    assert.equal(stillHeld?.unavailableReason, "currently not in UPT prop circulation");
    assert.equal(stillHeld?.price, 85);
    assert.equal(stillHeld?.weightLbs, 2.5);
    assert.equal(stillHeld?.customerFacingNotes, "Back in spring.");
    assert.equal(stillPhoto?.availability, "available");
    assert.equal(stillPhoto?.price, 40);
    assert.equal(stillPhoto?.photos.length, 1);

    await removeItemPhoto(
      photoShop,
      created.id,
      photographed.id,
      stillPhoto!.photos[0].id,
    );
    const afterRemove = await getRequest(photoShop, created.id);
    const heldAfterRemove = afterRemove?.items.find((item) => item.id === held.id);
    assert.equal(heldAfterRemove?.availability, "not_available");
    assert.equal(heldAfterRemove?.unavailableReason, "currently not in UPT prop circulation");
    assert.equal(heldAfterRemove?.price, 85);
  });
});

describe("customer timezone is stored per profile", () => {
  const tzShop = `${DEMO_SHOP}-tz-test`;

  const purge = async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: tzShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: tzShop } });
  };

  before(purge);
  after(purge);

  it("saves a real IANA zone and never writes it onto another customer", async () => {
    await submitCustomerRequest(tzShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera" }],
    });
    await submitCustomerRequest(tzShop, {
      name: "Jordan Lee",
      email: "jordan.lee@example.com",
      items: [{ plantName: "Hoya" }],
    });

    assert.equal(
      await saveCustomerTimeZone(tzShop, "alex.rivera@example.com", "America/Los_Angeles"),
      "America/Los_Angeles",
    );
    assert.equal(
      await saveCustomerTimeZone(tzShop, "jordan.lee@example.com", "America/New_York"),
      "America/New_York",
    );
    assert.equal(
      await saveCustomerTimeZone(tzShop, "alex.rivera@example.com", "Not/AZone"),
      null,
    );

    assert.equal(
      await getCustomerTimeZone(tzShop, "alex.rivera@example.com"),
      "America/Los_Angeles",
    );
    assert.equal(
      await getCustomerTimeZone(tzShop, "jordan.lee@example.com"),
      "America/New_York",
    );

    const alex = await prisma.customerProfile.findUnique({
      where: {
        shop_email: { shop: tzShop, email: "alex.rivera@example.com" },
      },
    });
    assert.equal(alex?.timeZone, "America/Los_Angeles");
    assert.equal(alex?.createdAt.toISOString().endsWith("Z"), true);
  });

  it("formats the customer offer deadline in that customer's zone", async () => {
    const created = await submitCustomerRequest(tzShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera" }],
    });
    await updateRequestItem(tzShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 50,
      weightLbs: 1,
    });
    await addItemPhotos(tzShop, created.id, created.items[0].id, [
      { url: "https://cdn.example.com/tz.jpg" },
    ]);
    await saveCustomerTimeZone(
      tzShop,
      "alex.rivera@example.com",
      "America/Los_Angeles",
    );
    const offered = await sendOffer(tzShop, created.id, 3);
    const offer = await buildCustomerOffer(tzShop, created.id);
    assert.ok(offer);
    assert.match(offer!.expiresAt, /P[SD]T/);
    assert.equal(
      offer!.expiresAtIso,
      offered?.sentOffer?.expiresAtIso ?? offer!.expiresAtIso,
    );
    assert.ok(offer!.expiresAtIso.endsWith("Z"));
  });
});

describe("admin internal notes", () => {
  const notesShop = `${shop}-internal-notes`;

  before(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: notesShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: notesShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: notesShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: notesShop } });
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop: notesShop } });
    await prisma.customerProfile.deleteMany({ where: { shop: notesShop } });
    await prisma.shopSettings.deleteMany({ where: { shop: notesShop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop: notesShop } });
  });

  it("stores each note with a timestamp and ignores blank saves", async () => {
    const created = await submitCustomerRequest(notesShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera" }],
    });

    assert.equal(await addInternalNote(notesShop, created.id, "   "), null);
    const first = await addInternalNote(
      notesShop,
      created.id,
      "Customer asked about leaf size.",
    );
    assert.ok(first);
    assert.equal(first?.body, "Customer asked about leaf size.");
    assert.match(first!.createdAt, /\d{4}/);
    assert.ok(first!.createdAtIso);

    await addInternalNote(notesShop, created.id, "Follow up after the offer.");
    const notes = await listInternalNotes(notesShop, created.id);
    assert.equal(notes.length, 2);
    assert.equal(notes[0]?.body, "Customer asked about leaf size.");
    assert.equal(notes[1]?.body, "Follow up after the offer.");
    assert.ok(
      new Date(notes[0]!.createdAtIso).getTime() <=
        new Date(notes[1]!.createdAtIso).getTime(),
    );
  });
});
