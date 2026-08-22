import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { DEMO_SHOP } from "./shop";
import {
  addItemPhotos,
  buildCustomerOffer,
  closeRequest,
  getCustomerResponse,
  getRequest,
  getShopSettings,
  listCustomerRequests,
  listRequests,
  moveItemPhoto,
  removeItemPhoto,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
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
  });
});
