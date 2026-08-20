import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  createExactPlantListing,
  ExactPlantListingError,
  getDeclinedExactPlantReview,
  listDeclinedExactPlants,
} from "./exact-plants.server";
import {
  getCustomerResponse,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-exact-plants-test`;

async function createOfferedRequest(options?: {
  rejectAvailable?: boolean;
  acceptAvailable?: boolean;
  includeUnavailable?: boolean;
}) {
  const created = await submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [
      { plantName: "Thai Constellation", notes: "Climbing, please" },
      ...(options?.includeUnavailable === false
        ? []
        : [{ plantName: "Ghost Plant" }]),
    ],
  });

  const available = created.items[0];
  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: available.id,
    offeredName: "Thai Constellation Exact",
    price: 175,
    weightLbs: 9.5,
    customerFacingNotes: "This exact plant has a small scar. Do not list this note.",
    availability: "available",
    photoUrls: [
      "https://picsum.photos/seed/thai-one/800/800",
      "https://picsum.photos/seed/thai-two/800/800",
    ],
  });

  const unavailable = created.items[1];
  if (unavailable) {
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: unavailable.id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
      customerFacingNotes: "Not currently in inventory.",
    });
  }

  await sendOffer(shop, created.id, 5);

  const choice =
    options?.acceptAvailable ? "accept" : options?.rejectAvailable === false ? "accept" : "reject";

  await saveCustomerResponse(shop, {
    requestId: created.id,
    fedexUpgradeSelected: false,
    fedexUpgradePrice: 15,
    items: [
      {
        offerItemId: "a",
        sourceItemId: available.id,
        plantName: "Thai Constellation Exact",
        choice,
        price: 175,
        quantity: 1,
        lineRevenue: choice === "accept" ? 175 : 0,
        customerNotes: "This exact plant has a small scar. Do not list this note.",
        photoUrls: [
          "https://picsum.photos/seed/thai-one/800/800",
          "https://picsum.photos/seed/thai-two/800/800",
        ],
      },
      ...(unavailable
        ? [
            {
              offerItemId: "b",
              sourceItemId: unavailable.id,
              plantName: "Ghost Plant",
              choice: "unavailable" as const,
              price: 0,
              quantity: 1,
              lineRevenue: 0,
              customerNotes: "Not currently in inventory.",
              photoUrls: [],
              unavailableReason: "not in our current inventory",
            },
          ]
        : []),
    ],
  });

  return { request: created, availableId: available.id, unavailableId: unavailable?.id };
}

describe("declined exact plant listings", () => {
  before(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  });

  it("saves the customer rejection without creating a Shopify listing", async () => {
    const { request, availableId, unavailableId } = await createOfferedRequest();
    const response = await getCustomerResponse(shop, request.id);
    assert.equal(
      response?.items.find((item) => item.sourceItemId === availableId)?.choice,
      "reject",
    );

    const listings = await prisma.exactPlantListing.findMany({
      where: { shop },
    });
    assert.equal(listings.length, 0);

    const declined = await listDeclinedExactPlants(shop, request.id);
    assert.equal(declined.length, 1);
    assert.equal(declined[0]?.requestItemId, availableId);
    assert.equal(declined[0]?.weightLbs, 9.5);
    assert.equal(declined.some((item) => item.requestItemId === unavailableId), false);

    const review = await getDeclinedExactPlantReview(shop, availableId);
    assert.equal(review.listing, null);
    assert.equal(review.draft.title, "Thai Constellation Exact");
    assert.equal(review.draft.price, 175);
    assert.equal(review.draft.weightLbs, 9.5);
    assert.equal(JSON.stringify(review.draft).includes("scar"), false);
    assert.equal(JSON.stringify(review.draft).includes("Alex Rivera"), false);
    assert.equal(
      (await prisma.exactPlantListing.count({ where: { shop } })),
      0,
    );
  });

  it("creates a listing only after admin approval and is idempotent", async () => {
    const { availableId } = await createOfferedRequest();
    const created = await createExactPlantListing(undefined, shop, {
      requestItemId: availableId,
      title: "Thai Constellation Showcase",
      price: 189,
      weightLbs: 9.5,
      photoUrls: ["https://picsum.photos/seed/thai-one/800/800"],
    });

    assert.equal(created.status, "listed");
    assert.ok(created.shopifyProductGid);
    assert.ok(created.shopifyProductHandle);
    assert.equal(created.title, "Thai Constellation Showcase");
    assert.equal(created.price, 189);
    assert.equal(created.weightLbs, 9.5);
    assert.deepEqual(created.photoUrls, [
      "https://picsum.photos/seed/thai-one/800/800",
    ]);

    const item = await prisma.requestItem.findUnique({ where: { id: availableId } });
    assert.equal(item?.itemStatus, "Listed");

    const listedRows = await listDeclinedExactPlants(shop);
    const listedRow = listedRows.find((row) => row.requestItemId === availableId);
    assert.equal(listedRow?.title, "Thai Constellation Showcase");
    assert.equal(listedRow?.price, 189);
    assert.equal(listedRow?.listing?.status, "listed");

    const retry = await createExactPlantListing(undefined, shop, {
      requestItemId: availableId,
      title: "Should Not Duplicate",
      price: 1,
      weightLbs: 1,
      photoUrls: [],
    });
    assert.equal(retry.shopifyProductGid, created.shopifyProductGid);
    assert.equal(retry.title, created.title);

    const listingCount = await prisma.exactPlantListing.count({
      where: { requestItemId: availableId },
    });
    assert.equal(listingCount, 1);
  });

  it("keeps the rejection and allows an idempotent retry after listing failure", async () => {
    const { request, availableId } = await createOfferedRequest();
    const failingAdmin = {
      graphql: async () => {
        throw new Error("Shopify productCreate failed");
      },
    };

    await assert.rejects(
      () =>
        createExactPlantListing(failingAdmin, shop, {
          requestItemId: availableId,
          title: "Thai Constellation Exact",
          price: 175,
          weightLbs: 9.5,
          photoUrls: ["https://picsum.photos/seed/thai-one/800/800"],
        }),
      ExactPlantListingError,
    );

    const failed = await prisma.exactPlantListing.findUnique({
      where: { requestItemId: availableId },
    });
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.shopifyProductGid, null);
    const response = await getCustomerResponse(shop, request.id);
    assert.equal(
      response?.items.find((item) => item.sourceItemId === availableId)?.choice,
      "reject",
    );

    const retried = await createExactPlantListing(undefined, shop, {
      requestItemId: availableId,
      title: "Thai Constellation Exact",
      price: 175,
      weightLbs: 9.5,
      photoUrls: ["https://picsum.photos/seed/thai-one/800/800"],
    });
    assert.equal(retried.status, "listed");
    assert.ok(retried.shopifyProductGid);
  });

  it("does not create listings for accepted or UPT not-available items", async () => {
    const { availableId, unavailableId } = await createOfferedRequest({
      acceptAvailable: true,
    });

    await assert.rejects(
      () =>
        createExactPlantListing(undefined, shop, {
          requestItemId: availableId,
          title: "Accepted plant",
          price: 175,
          weightLbs: 9.5,
          photoUrls: [],
        }),
      /Accepted/,
    );

    if (unavailableId) {
      await assert.rejects(
        () =>
          createExactPlantListing(undefined, shop, {
            requestItemId: unavailableId,
            title: "Unavailable plant",
            price: 0,
            weightLbs: 0,
            photoUrls: [],
          }),
        /Not Available|Unavailable/,
      );
    }

    assert.equal((await listDeclinedExactPlants(shop)).every((row) => row.requestItemId !== availableId), true);
  });
});
