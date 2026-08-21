import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  createExactPlantListing,
  ExactPlantListingError,
  getExactPlantReview,
  listExactPlantCandidates,
} from "./exact-plants.server";
import {
  getCustomerResponse,
  saveCustomerResponse,
  sendOffer,
  expireOverdueOffers,
  markRequestPaid,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-exact-plants-test`;

async function createOfferedRequest(options?: {
  rejectAvailable?: boolean;
  acceptAvailable?: boolean;
  includeUnavailable?: boolean;
  /** Skip the customer response entirely, as an unanswered offer would. */
  respond?: boolean;
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

  if (options?.respond === false) {
    return {
      request: created,
      availableId: available.id,
      unavailableId: unavailable?.id,
    };
  }

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

    const declined = await listExactPlantCandidates(shop, request.id);
    assert.equal(declined.length, 1);
    assert.equal(declined[0]?.requestItemId, availableId);
    assert.equal(declined[0]?.weightLbs, 9.5);
    assert.equal(declined.some((item) => item.requestItemId === unavailableId), false);

    const review = await getExactPlantReview(shop, availableId);
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

    const listedRows = await listExactPlantCandidates(shop);
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

  it("lets only one of two simultaneous approvals create the product", async () => {
    const { availableId } = await createOfferedRequest();
    const approve = () =>
      createExactPlantListing(undefined, shop, {
        requestItemId: availableId,
        title: "Thai Constellation Showcase",
        price: 189,
        weightLbs: 9.5,
        photoUrls: [],
      });

    // Two admin clicks, or one click and a retried POST. Before the claim both
    // passed the "already listed?" read and both called productCreate, leaving
    // a published product in the store that no row pointed at.
    const results = await Promise.allSettled([approve(), approve()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one approval may create the product");
    assert.equal(rejected.length, 1);
    assert.match(
      (rejected[0] as PromiseRejectedResult).reason.message,
      /already being listed/,
    );

    assert.equal(
      await prisma.exactPlantListing.count({ where: { requestItemId: availableId } }),
      1,
    );
    const row = await prisma.exactPlantListing.findUnique({
      where: { requestItemId: availableId },
    });
    assert.equal(row?.status, "listed");
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
      /accepted this plant and their hold has not expired/,
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

    assert.equal((await listExactPlantCandidates(shop)).every((row) => row.requestItemId !== availableId), true);
  });
});

/** Pushes the offer's hold into the past and runs the expiry sweep. */
async function expireOffer(requestId: string) {
  await prisma.offer.update({
    where: { requestId },
    data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  await expireOverdueOffers(shop);
}

describe("expired offers release their exact plants", () => {
  before(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
  });

  after(async () => {
    await prisma.plantRequest.deleteMany({ where: { shop } });
    await prisma.customerProfile.deleteMany({ where: { shop } });
  });

  it("releases a plant the customer accepted but never paid for", async () => {
    const { request, availableId, unavailableId } = await createOfferedRequest({
      acceptAvailable: true,
    });
    // Still held while the offer is live.
    assert.equal(
      (await listExactPlantCandidates(shop, request.id)).length,
      0,
      "an accepted plant must stay held until the offer expires",
    );

    await expireOffer(request.id);
    assert.equal(
      (await prisma.plantRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .status,
      "Expired",
    );

    const candidates = await listExactPlantCandidates(shop, request.id);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].requestItemId, availableId);
    assert.equal(candidates[0].releaseReason, "accepted_unpaid_expired");
    assert.equal(
      candidates.some((row) => row.requestItemId === unavailableId),
      false,
      "a Not Available plant is never released",
    );
  });

  it("releases a plant the customer never answered", async () => {
    const { request, availableId } = await createOfferedRequest({ respond: false });
    assert.equal((await listExactPlantCandidates(shop, request.id)).length, 0);

    await expireOffer(request.id);

    const candidates = await listExactPlantCandidates(shop, request.id);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].requestItemId, availableId);
    assert.equal(candidates[0].releaseReason, "never_responded_expired");
  });

  it("prefills the review form from the admin's own values, not the customer's", async () => {
    const { request, availableId } = await createOfferedRequest({ respond: false });
    await expireOffer(request.id);

    const review = await getExactPlantReview(shop, availableId);
    assert.equal(review.releaseReason, "never_responded_expired");
    assert.equal(review.draft.title, "Thai Constellation Exact");
    assert.equal(review.draft.price, 175);
    assert.equal(review.draft.weightLbs, 9.5);
    assert.equal(review.draft.photoUrls.length, 2);
    // Customer-facing notes and identity must never reach a public product.
    const serialized = JSON.stringify(review.draft);
    assert.equal(serialized.includes("scar"), false);
    assert.equal(serialized.includes("Alex Rivera"), false);
    assert.equal(serialized.includes(request.requestNumber), false);
  });

  it("creates the product only after approval, once", async () => {
    const { request, availableId } = await createOfferedRequest({ respond: false });
    await expireOffer(request.id);

    assert.equal(await prisma.exactPlantListing.count({ where: { shop } }), 0);

    const first = await createExactPlantListing(undefined, shop, {
      requestItemId: availableId,
      title: "Thai Constellation Exact",
      price: 199,
      weightLbs: 9.5,
      photoUrls: ["https://picsum.photos/seed/thai-one/800/800"],
    });
    assert.equal(first.status, "listed");
    assert.ok(first.shopifyProductGid);

    const second = await createExactPlantListing(undefined, shop, {
      requestItemId: availableId,
      title: "Renamed",
      price: 250,
      weightLbs: 1,
      photoUrls: [],
    });
    assert.equal(second.shopifyProductGid, first.shopifyProductGid);
    assert.equal(second.title, first.title, "a retry must not duplicate or rename");
    assert.equal(await prisma.exactPlantListing.count({ where: { shop } }), 1);
    assert.equal(
      (await prisma.requestItem.findUniqueOrThrow({ where: { id: availableId } }))
        .itemStatus,
      "Listed",
    );
  });

  it("never releases a plant from a paid, closed request", async () => {
    const { request, availableId } = await createOfferedRequest({
      acceptAvailable: true,
    });
    await markRequestPaid(shop, request.id, {
      shopifyOrderGid: "gid://shopify/Order/1",
      orderNumber: "#1001",
      plantRevenue: 175,
    });
    assert.equal((await listExactPlantCandidates(shop, request.id)).length, 0);
    await assert.rejects(
      () => getExactPlantReview(shop, availableId),
      /paid and closed/,
    );
  });
});
