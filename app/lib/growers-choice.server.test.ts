import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { listExactPlantCandidates } from "./exact-plants.server";
import { createPaymentLinkForRequest } from "./offer-response.server";
import {
  acceptedOfferLines,
  claimDraftOrderCreation,
  DraftOrderInFlightError,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  linkExistingStock,
  markRequestPaid,
  expireOverdueOffers,
  OfferIncompleteError,
  releaseDraftOrderClaim,
  saveCustomerResponse,
  sendOffer,
  submitCustomerRequest,
  unlinkExistingStock,
  updateRequestItem,
} from "./portal.server";
import { inventoryHoldState, type StockVariantCandidate } from "./growers-choice";
import { DEMO_SHOP } from "./shop";

// The demo shop stubs a missing checkout link rather than refusing, which is
// what lets the reservation bookkeeping be exercised without an Admin API.
const shop = `${DEMO_SHOP}-growers-choice-test`;
// A merchant store, where a Shopify write with no Admin client is refused.
const merchantShop = "growers-choice-merchant.myshopify.com";

const VARIANT_GID = "gid://shopify/ProductVariant/9001";
const PRODUCT_GID = "gid://shopify/Product/9001";

function variant(
  overrides: Partial<StockVariantCandidate> = {},
): StockVariantCandidate {
  return {
    productGid: PRODUCT_GID,
    productTitle: "Monstera Thai Constellation",
    productHandle: "monstera-thai-constellation",
    productStatus: "ACTIVE",
    variantGid: VARIANT_GID,
    variantTitle: "6 inch",
    sku: "MTC-6",
    price: 285,
    inventoryQuantity: 3,
    inventoryTracked: true,
    availableForSale: true,
    weightLbs: 4.5,
    imageUrl: "https://cdn.shopify.com/s/files/1/listing.jpg",
    ...overrides,
  };
}

async function purge(target: string) {
  await prisma.emailMessage.deleteMany({ where: { shop: target } });
  await prisma.plantRequest.deleteMany({ where: { shop: target } });
  await prisma.customerProfile.deleteMany({ where: { shop: target } });
  await prisma.shopSettings.deleteMany({ where: { shop: target } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop: target } });
}

async function reset() {
  await purge(shop);
  await purge(merchantShop);
}

/** A New request with one item, nothing decided about it yet. */
async function newRequest(target = shop) {
  const created = await submitCustomerRequest(target, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [{ plantName: "Monstera Thai" }],
  });
  return { requestId: created.id, itemId: created.items[0].id };
}

/** A sent offer whose one plant comes off the shelf. */
async function offeredFromStock(options?: {
  target?: string;
  variant?: Partial<StockVariantCandidate>;
  price?: number;
}) {
  const target = options?.target ?? shop;
  const { requestId, itemId } = await newRequest(target);
  await updateRequestItem(target, {
    requestId,
    itemId,
    availability: "available",
    fulfillmentType: "growers_choice",
    customerFacingNotes: "Chosen by us from this listing.",
    ...(options?.price === undefined ? {} : { price: options.price }),
  });
  await linkExistingStock(target, {
    requestId,
    itemId,
    variant: variant(options?.variant),
  });
  await sendOffer(target, requestId, 3);
  return { requestId, itemId };
}

/** The customer's answer to the one-plant offer above. */
async function answerFromStock(
  requestId: string,
  itemId: string,
  choice: "accept" | "reject",
  target = shop,
) {
  const offerItem = await prisma.offerItem.findFirstOrThrow({
    where: { requestItemId: itemId },
  });
  return saveCustomerResponse(target, {
    requestId,
    fedexUpgradeSelected: false,
    fedexUpgradePrice: 15,
    items: [
      {
        offerItemId: "offer-1",
        sourceItemId: itemId,
        plantName: offerItem.plantName,
        choice,
        price: offerItem.price,
        quantity: 1,
        lineRevenue: choice === "accept" ? offerItem.price : 0,
        customerNotes: offerItem.customerFacingNotes,
        photoUrls: [],
        fulfillmentType: "growers_choice" as const,
        linkedProductTitle: offerItem.linkedProductTitle ?? undefined,
        linkedVariantTitle: offerItem.linkedVariantTitle ?? undefined,
        linkedVariantGid: offerItem.linkedVariantGid ?? undefined,
        linkedImageUrl: offerItem.linkedImageUrl ?? undefined,
      },
    ],
  });
}

describe("linking a request item to existing website stock", () => {
  before(reset);
  after(reset);

  it("records the listing and prefills the price from it", async () => {
    const { requestId, itemId } = await newRequest();
    const updated = await linkExistingStock(shop, {
      requestId,
      itemId,
      variant: variant(),
    });

    const item = updated?.items.find((entry) => entry.id === itemId);
    assert.equal(item?.fulfillmentType, "growers_choice");
    assert.equal(item?.availability, "available");
    assert.equal(item?.price, 285, "an unpriced item takes the listing's price");
    assert.deepEqual(
      {
        productTitle: item?.linkedStock?.productTitle,
        variantGid: item?.linkedStock?.variantGid,
        variantTitle: item?.linkedStock?.variantTitle,
        inventoryQuantity: item?.linkedStock?.inventoryQuantity,
        inventoryTracked: item?.linkedStock?.inventoryTracked,
        variantWeightLbs: item?.linkedStock?.variantWeightLbs,
      },
      {
        productTitle: "Monstera Thai Constellation",
        variantGid: VARIANT_GID,
        variantTitle: "6 inch",
        inventoryQuantity: 3,
        inventoryTracked: true,
        variantWeightLbs: 4.5,
      },
    );
  });

  it("leaves a price the admin typed alone", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "available",
      price: 199,
    });
    const updated = await linkExistingStock(shop, {
      requestId,
      itemId,
      variant: variant(),
    });

    assert.equal(
      updated?.items.find((entry) => entry.id === itemId)?.price,
      199,
      "relinking must not silently undo the admin's own price",
    );
  });

  it("reserves nothing, because nobody has accepted anything yet", async () => {
    const { requestId, itemId } = await newRequest();
    await linkExistingStock(shop, { requestId, itemId, variant: variant() });

    assert.equal(await getDraftOrder(shop, requestId), null);
  });

  it("puts the item back on the exact-plant route when unlinked", async () => {
    const { requestId, itemId } = await newRequest();
    await linkExistingStock(shop, { requestId, itemId, variant: variant() });
    const unlinked = await unlinkExistingStock(shop, requestId, itemId);

    const item = unlinked?.items.find((entry) => entry.id === itemId);
    assert.equal(item?.fulfillmentType, "exact_plant");
    assert.equal(item?.linkedStock, undefined);
  });

  it("drops the link when the admin marks the plant unavailable", async () => {
    // A link left behind would be invisible on the page and still be the
    // variant the draft order billed and held.
    const { requestId, itemId } = await newRequest();
    await linkExistingStock(shop, { requestId, itemId, variant: variant() });
    const updated = await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });

    const item = updated?.items.find((entry) => entry.id === itemId);
    assert.equal(item?.linkedStock, undefined);
    assert.equal(item?.fulfillmentType, "not_available");
  });

  it("refuses to relink once the offer is sent", async () => {
    const { requestId, itemId } = await offeredFromStock();

    await assert.rejects(
      linkExistingStock(shop, {
        requestId,
        itemId,
        variant: variant({ variantGid: "gid://shopify/ProductVariant/other" }),
      }),
      /only be linked before an offer is sent/,
    );
    await assert.rejects(
      unlinkExistingStock(shop, requestId, itemId),
      /only be unlinked before an offer is sent/,
    );
  });
});

describe("an offer that cannot be sent", () => {
  before(reset);
  after(reset);

  it("refuses a Grower's Choice item with nothing linked", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "available",
      fulfillmentType: "growers_choice",
      price: 285,
      weightLbs: 4,
    });

    const error = await sendOffer(shop, requestId, 3).catch((thrown) => thrown);
    assert.ok(error instanceof OfferIncompleteError);
    assert.deepEqual(error.problems, [
      { itemName: "Monstera Thai", missing: ["a linked store listing"] },
    ]);
  });

  it("refuses a linked listing that no longer holds one", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "available",
      fulfillmentType: "growers_choice",
    });
    await linkExistingStock(shop, {
      requestId,
      itemId,
      variant: variant({ inventoryQuantity: 0 }),
    });

    const error = await sendOffer(shop, requestId, 3).catch((thrown) => thrown);
    assert.ok(error instanceof OfferIncompleteError);
    assert.deepEqual(error.problems, [
      {
        itemName: "Monstera Thai",
        missing: ["enough stock on the linked listing"],
      },
    ]);
  });

  it("asks for no exact photo, there being no one plant to photograph", async () => {
    const { requestId, itemId } = await offeredFromStock();
    const request = await getRequest(shop, requestId);

    assert.equal(request?.status, "Pending");
    assert.deepEqual(
      request?.items.find((entry) => entry.id === itemId)?.photos,
      [],
    );
  });
});

describe("the offer snapshot of a Grower's Choice plant", () => {
  before(reset);
  after(reset);

  it("freezes the listing, and later Shopify edits do not rewrite it", async () => {
    const { requestId, itemId } = await offeredFromStock();

    const before = await prisma.offerItem.findFirstOrThrow({
      where: { requestItemId: itemId },
    });
    assert.deepEqual(
      {
        fulfillmentType: before.fulfillmentType,
        linkedProductTitle: before.linkedProductTitle,
        linkedVariantTitle: before.linkedVariantTitle,
        linkedVariantGid: before.linkedVariantGid,
        linkedImageUrl: before.linkedImageUrl,
        price: before.price,
        weightLbs: before.weightLbs,
        photoUrlsJson: before.photoUrlsJson,
      },
      {
        fulfillmentType: "growers_choice",
        linkedProductTitle: "Monstera Thai Constellation",
        linkedVariantTitle: "6 inch",
        linkedVariantGid: VARIANT_GID,
        linkedImageUrl: "https://cdn.shopify.com/s/files/1/listing.jpg",
        price: 285,
        // The listing's own weight, which is what the plant ships on.
        weightLbs: 4.5,
        // An exact-plant photograph is of one individual plant, and a
        // Grower's Choice customer is not being sold that individual.
        photoUrlsJson: "[]",
      },
    );

    await answerFromStock(requestId, itemId, "accept");

    // The merchant renames and reprices the product in Shopify, and the next
    // read of the variant writes the new figures onto the request item.
    await prisma.requestItem.update({
      where: { id: itemId },
      data: {
        linkedProductTitle: "Monstera Thai Constellation — RENAMED",
        linkedVariantTitle: "8 inch",
        linkedVariantPrice: 420,
        linkedVariantGid: "gid://shopify/ProductVariant/relinked",
        linkedImageUrl: "https://cdn.shopify.com/s/files/1/reshot.jpg",
        price: 420,
      },
    });

    const offerAfter = await prisma.offerItem.findFirstOrThrow({
      where: { requestItemId: itemId },
    });
    assert.deepEqual(offerAfter, before, "the offer is what the customer saw");

    const answer = await getCustomerResponse(shop, requestId);
    const answered = answer?.items[0];
    assert.deepEqual(
      {
        fulfillmentType: answered?.fulfillmentType,
        plantName: answered?.plantName,
        linkedProductTitle: answered?.linkedProductTitle,
        linkedVariantTitle: answered?.linkedVariantTitle,
        linkedVariantGid: answered?.linkedVariantGid,
        price: answered?.price,
        choice: answered?.choice,
        customerNotes: answered?.customerNotes,
      },
      {
        fulfillmentType: "growers_choice",
        plantName: "Monstera Thai",
        linkedProductTitle: "Monstera Thai Constellation",
        linkedVariantTitle: "6 inch",
        linkedVariantGid: VARIANT_GID,
        price: 285,
        choice: "accept",
        customerNotes: "Chosen by us from this listing.",
      },
    );

    // And the order still bills the variant and the price the customer
    // answered, not the renamed one.
    const { items } = await acceptedOfferLines(shop, requestId);
    assert.deepEqual(items, [
      {
        itemId,
        plantName: "Monstera Thai",
        quantity: 1,
        price: 285,
        weightLbs: 4.5,
        variantId: VARIANT_GID,
      },
    ]);
  });
});

describe("the EXACT PLANTS queue", () => {
  before(reset);
  after(reset);

  it("does not take a rejected Grower's Choice plant, which is already listed", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "reject");

    assert.deepEqual(await listExactPlantCandidates(shop, requestId), []);
  });

  it("still takes a rejected exact plant", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      offeredName: "Monstera Thai Exact",
      availability: "available",
      price: 285,
      weightLbs: 4,
      photoUrls: ["https://cdn.example.com/exact.jpg"],
    });
    await sendOffer(shop, requestId, 3);
    await saveCustomerResponse(shop, {
      requestId,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: 15,
      items: [
        {
          offerItemId: "offer-1",
          sourceItemId: itemId,
          plantName: "Monstera Thai Exact",
          choice: "reject",
          price: 285,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "",
          photoUrls: ["https://cdn.example.com/exact.jpg"],
          fulfillmentType: "exact_plant" as const,
        },
      ],
    });

    const candidates = await listExactPlantCandidates(shop, requestId);
    assert.deepEqual(
      candidates.map((candidate) => candidate.requestItemId),
      [itemId],
    );
  });

  it("never takes a Not Available plant", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });
    await sendOffer(shop, requestId, 3);

    assert.deepEqual(await listExactPlantCandidates(shop, requestId), []);
  });
});

describe("holding the stock behind an accepted plant", () => {
  before(reset);
  after(reset);

  it("bills the real variant and asks for the hold to end at the deadline", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");

    const created = await createPaymentLinkForRequest({ shop, requestId });
    assert.equal(created.ok, true);

    const draft = await getDraftOrder(shop, requestId);
    const offer = await prisma.offer.findUniqueOrThrow({ where: { requestId } });
    assert.deepEqual(
      draft?.reserveInventoryUntil,
      offer.expiresAt,
      "the hold ends exactly when the customer's own payment deadline does",
    );

    const lines = JSON.parse(draft?.lineItemsJson ?? "[]");
    assert.equal(lines[0]?.variantId, VARIANT_GID);
    // Nothing was flagged, so the request page does not claim a problem.
    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(item.fulfillmentIssue, null);
  });

  it("holds the stock until the deadline and lets it go afterwards", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");
    await createPaymentLinkForRequest({ shop, requestId });

    const draft = await getDraftOrder(shop, requestId);
    const until = draft?.reserveInventoryUntil ?? null;
    assert.ok(until);
    assert.equal(
      inventoryHoldState({
        reserveInventoryUntil: until,
        now: new Date(until.getTime() - 1000),
      }),
      "held",
    );

    // Shopify releases the hold on its own clock at exactly this moment, which
    // is what makes the release survive a portal that is down.
    await prisma.offer.update({
      where: { requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(await expireOverdueOffers(shop), 1);
    assert.equal(
      (await getRequest(shop, requestId))?.status,
      "Expired",
      "the request expires at the same moment the hold does",
    );
    assert.equal(
      inventoryHoldState({
        reserveInventoryUntil: until,
        now: new Date(until.getTime() + 1000),
      }),
      "released",
    );
  });

  it("reads as a plain sale once the customer has paid", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");
    await createPaymentLinkForRequest({ shop, requestId });
    await markRequestPaid(shop, requestId, {
      shopifyOrderGid: "gid://shopify/Order/55",
      orderNumber: "#1055",
      plantRevenue: 285,
    });

    const request = await getRequest(shop, requestId);
    const draft = await getDraftOrder(shop, requestId);
    assert.equal(request?.status, "Closed");
    assert.equal(
      inventoryHoldState({
        reserveInventoryUntil: draft?.reserveInventoryUntil,
        paidAt: request?.paidAt,
      }),
      "purchased",
      "a paid order deducts the stock, so there is no hold left to reason about",
    );
  });

  it("holds nothing for an exact plant, which Shopify has no stock of", async () => {
    const { requestId, itemId } = await newRequest();
    await updateRequestItem(shop, {
      requestId,
      itemId,
      availability: "available",
      price: 250,
      weightLbs: 3,
      photoUrls: ["https://cdn.example.com/exact.jpg"],
    });
    await sendOffer(shop, requestId, 3);
    await saveCustomerResponse(shop, {
      requestId,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: 15,
      items: [
        {
          offerItemId: "offer-1",
          sourceItemId: itemId,
          plantName: "Monstera Thai",
          choice: "accept",
          price: 250,
          quantity: 1,
          lineRevenue: 250,
          customerNotes: "",
          photoUrls: ["https://cdn.example.com/exact.jpg"],
          fulfillmentType: "exact_plant" as const,
        },
      ],
    });
    await createPaymentLinkForRequest({ shop, requestId });

    const draft = await getDraftOrder(shop, requestId);
    assert.equal(draft?.reserveInventoryUntil, null);
    assert.equal(JSON.parse(draft?.lineItemsJson ?? "[]")[0]?.variantId, undefined);
  });
});

describe("no oversell under retries or concurrency", () => {
  before(reset);
  after(reset);

  it("creates one draft order however many times the button is pressed", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");

    const first = await createPaymentLinkForRequest({ shop, requestId });
    const second = await createPaymentLinkForRequest({ shop, requestId });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(
      first.ok && second.ok ? first.invoiceUrl === second.invoiceUrl : false,
      true,
      "the recorded draft order is reused rather than replaced",
    );
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      1,
    );
  });

  it("refuses a second attempt while the first is still talking to Shopify", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");

    // The window the claim exists for: an attempt that has read "nothing
    // recorded" and is somewhere between there and Shopify returning a draft
    // order. A second attempt landing inside it would hold the plant twice.
    await claimDraftOrderCreation(shop, requestId);
    await assert.rejects(
      claimDraftOrderCreation(shop, requestId),
      DraftOrderInFlightError,
    );

    const blocked = await createPaymentLinkForRequest({ shop, requestId });
    assert.equal(blocked.ok, false);
    assert.match(!blocked.ok ? blocked.error : "", /already being created/);
    assert.equal(
      await prisma.draftOrderReference.count({
        where: { requestId, invoiceUrl: { not: null } },
      }),
      0,
      "nothing was created, so nothing is payable and nothing is held",
    );

    // Giving the claim back is what lets the merchant retry immediately rather
    // than waiting the window out.
    await releaseDraftOrderClaim(shop, requestId);
    const retried = await createPaymentLinkForRequest({ shop, requestId });
    assert.equal(retried.ok, true);
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      1,
    );
  });

  it("lets only one of two simultaneous attempts reach Shopify", async () => {
    const { requestId, itemId } = await offeredFromStock();
    await answerFromStock(requestId, itemId, "accept");

    // Both read "no draft order recorded" before either records one, which is
    // what a double click, a retried POST or two app instances produce. Without
    // the claim both would ask Shopify to hold the same plant.
    const results = await Promise.all([
      createPaymentLinkForRequest({ shop, requestId }),
      createPaymentLinkForRequest({ shop, requestId }),
    ]);

    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      1,
      "one plant is never held twice",
    );
    const refused = results.filter((result) => !result.ok);
    assert.ok(refused.length <= 1, "at most one attempt is turned away");
    for (const result of refused) {
      assert.match(
        !result.ok ? result.error : "",
        /already being created/,
        "and it says so rather than reporting a Shopify failure",
      );
    }
  });
});

type Call = { operation: string; variables: Record<string, unknown> };

/**
 * Stands in for the Admin API. What matters here is not only what comes back
 * but which calls are made at all: a draft order that must not be created is
 * proved by `CreatePlantRequestDraftOrder` never appearing.
 */
function fakeAdmin(responses: Record<string, unknown>, calls: Call[]) {
  return {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      const operation = query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
      calls.push({ operation, variables: options?.variables ?? {} });
      const data = responses[operation];
      assert.ok(data !== undefined, `unexpected Shopify operation ${operation}`);
      return { json: async () => ({ data }) };
    },
  } as unknown as Parameters<typeof createPaymentLinkForRequest>[0]["admin"];
}

const DRAFT_ORDER_GID = "gid://shopify/DraftOrder/77";
const INVOICE_URL = "https://growers-choice-merchant.myshopify.com/invoices/77";

/** The live variant read, as `assertLinkedStockStillAvailable` asks for it. */
function liveVariant(overrides: { inventoryQuantity?: number | null; status?: string }) {
  return {
    nodes: [
      {
        id: VARIANT_GID,
        title: "6 inch",
        sku: "MTC-6",
        price: "285.00",
        availableForSale: true,
        inventoryQuantity: overrides.inventoryQuantity ?? 3,
        inventoryItem: {
          tracked: true,
          measurement: { weight: { value: 4.5, unit: "POUNDS" } },
        },
        media: { nodes: [] },
        product: {
          id: PRODUCT_GID,
          title: "Monstera Thai Constellation",
          handle: "monstera-thai-constellation",
          status: overrides.status ?? "ACTIVE",
          featuredMedia: null,
        },
      },
    ],
  };
}

function shopifyResponses(overrides: Record<string, unknown> = {}) {
  return {
    PortalShopCurrency: { shop: { currencyCode: "USD" } },
    PlantRequestDraftOrderByTag: { draftOrders: { nodes: [] } },
    PortalStockVariantsById: liveVariant({}),
    CreatePlantRequestDraftOrder: {
      draftOrderCreate: {
        draftOrder: {
          id: DRAFT_ORDER_GID,
          invoiceUrl: INVOICE_URL,
          reserveInventoryUntil: null,
        },
        userErrors: [],
      },
    },
    SendPlantRequestInvoice: {
      draftOrderInvoiceSend: { draftOrder: { id: DRAFT_ORDER_GID }, userErrors: [] },
    },
    ...overrides,
  };
}

describe("asking Shopify to hold the stock", () => {
  before(reset);
  after(reset);

  async function acceptedOnMerchantShop() {
    const { requestId, itemId } = await offeredFromStock({ target: merchantShop });
    await answerFromStock(requestId, itemId, "accept", merchantShop);
    const offer = await prisma.offer.findUniqueOrThrow({ where: { requestId } });
    return { requestId, itemId, expiresAt: offer.expiresAt };
  }

  it("sells the real variant and asks for the hold to end at the deadline", async () => {
    const { requestId, expiresAt } = await acceptedOnMerchantShop();
    const calls: Call[] = [];
    const reservedUntil = new Date(expiresAt.getTime());

    const created = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          CreatePlantRequestDraftOrder: {
            draftOrderCreate: {
              draftOrder: {
                id: DRAFT_ORDER_GID,
                invoiceUrl: INVOICE_URL,
                reserveInventoryUntil: reservedUntil.toISOString(),
              },
              userErrors: [],
            },
          },
        }),
        calls,
      ),
    });

    assert.equal(created.ok, true);
    const sent = calls.find(
      (call) => call.operation === "CreatePlantRequestDraftOrder",
    );
    const input = sent?.variables.input as {
      reserveInventoryUntil?: string;
      lineItems: Array<Record<string, unknown>>;
    };
    assert.equal(input.reserveInventoryUntil, expiresAt.toISOString());
    assert.deepEqual(input.lineItems, [
      {
        variantId: VARIANT_GID,
        quantity: 1,
        originalUnitPriceWithCurrency: { amount: "285.00", currencyCode: "USD" },
        requiresShipping: true,
        weight: { value: 4.5, unit: "POUNDS" },
      },
    ]);

    const draft = await getDraftOrder(merchantShop, requestId);
    assert.deepEqual(draft?.reserveInventoryUntil, reservedUntil);
  });

  it("re-reads the stock before reserving, and refuses when it has gone", async () => {
    const { requestId, itemId } = await acceptedOnMerchantShop();
    const calls: Call[] = [];

    const refused = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          PortalStockVariantsById: liveVariant({ inventoryQuantity: 0 }),
        }),
        calls,
      ),
    });

    assert.equal(refused.ok, false);
    assert.match(
      !refused.ok ? refused.error : "",
      /only 0 of the 1 needed is left in stock/,
    );
    assert.match(!refused.ok ? refused.error : "", /nothing has been charged/);

    // Never an oversell: no draft order was even attempted, so nothing is
    // payable and no stock was asked for.
    assert.equal(
      calls.some((call) => call.operation === "CreatePlantRequestDraftOrder"),
      false,
    );
    assert.equal(await getDraftOrder(merchantShop, requestId), null);
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      0,
      "the claim is given back, so the merchant can retry once they restock",
    );

    // The customer's answer stands, and the merchant is the one told.
    const answer = await getCustomerResponse(merchantShop, requestId);
    assert.equal(answer?.items[0]?.choice, "accept");
    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.match(item.fulfillmentIssue ?? "", /left in stock/);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: { startsWith: "Existing stock unavailable" } },
      }),
      1,
    );
  });

  it("refuses when the linked listing has been deactivated in Shopify", async () => {
    const { requestId } = await acceptedOnMerchantShop();
    const calls: Call[] = [];

    const refused = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          PortalStockVariantsById: liveVariant({ status: "ARCHIVED" }),
        }),
        calls,
      ),
    });

    assert.equal(refused.ok, false);
    assert.match(
      !refused.ok ? refused.error : "",
      /Shopify product is no longer active/,
    );
    assert.equal(
      calls.some((call) => call.operation === "CreatePlantRequestDraftOrder"),
      false,
    );
  });

  it("reports Shopify's own refusal to hold the stock as a stock problem", async () => {
    // The pre-check can only ever have been true a moment ago, so Shopify is
    // the authority — and it reports this as an ordinary user error that would
    // otherwise reach the merchant as a generic Shopify failure.
    const { requestId } = await acceptedOnMerchantShop();

    const refused = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          CreatePlantRequestDraftOrder: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [
                { field: null, message: "Unavailable quantity for this variant" },
              ],
            },
          },
        }),
        [],
      ),
    });

    assert.equal(refused.ok, false);
    assert.match(
      !refused.ok ? refused.error : "",
      /Shopify would not hold the stock/,
    );
    assert.equal(await getDraftOrder(merchantShop, requestId), null);
  });

  it("tells the merchant when Shopify took the order but not the hold", async () => {
    const { requestId, itemId } = await acceptedOnMerchantShop();

    // The customer can still pay, so the order stands — but the plant is on
    // open sale and only the merchant can act on that.
    const created = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(shopifyResponses(), []),
    });

    assert.equal(created.ok, true);
    const draft = await getDraftOrder(merchantShop, requestId);
    assert.equal(draft?.invoiceUrl, INVOICE_URL);
    assert.equal(draft?.reserveInventoryUntil, null);
    const item = await prisma.requestItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.match(item.fulfillmentIssue ?? "", /still on open sale/);
  });

  it("reuses a draft order Shopify made when the reply was lost, holding nothing twice", async () => {
    const { requestId, expiresAt } = await acceptedOnMerchantShop();
    const calls: Call[] = [];

    const recovered = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          PlantRequestDraftOrderByTag: {
            draftOrders: {
              nodes: [
                {
                  id: DRAFT_ORDER_GID,
                  invoiceUrl: INVOICE_URL,
                  reserveInventoryUntil: expiresAt.toISOString(),
                },
              ],
            },
          },
        }),
        calls,
      ),
    });

    assert.equal(recovered.ok, true);
    assert.equal(
      calls.some((call) => call.operation === "CreatePlantRequestDraftOrder"),
      false,
      "a lost reply must not become a second order",
    );
    // Nor a second stock check: the hold this request is entitled to has
    // already been taken, and re-reading it would see our own reservation as
    // somebody else's sale.
    assert.equal(
      calls.some((call) => call.operation === "PortalStockVariantsById"),
      false,
    );
    const draft = await getDraftOrder(merchantShop, requestId);
    assert.deepEqual(draft?.reserveInventoryUntil, expiresAt);
  });

  it("does not ask again for a hold it already has", async () => {
    const { requestId, expiresAt } = await acceptedOnMerchantShop();
    await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(
        shopifyResponses({
          CreatePlantRequestDraftOrder: {
            draftOrderCreate: {
              draftOrder: {
                id: DRAFT_ORDER_GID,
                invoiceUrl: INVOICE_URL,
                reserveInventoryUntil: expiresAt.toISOString(),
              },
              userErrors: [],
            },
          },
        }),
        [],
      ),
    });

    const calls: Call[] = [];
    const again = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId,
      admin: fakeAdmin(shopifyResponses(), calls),
    });

    assert.equal(again.ok, true);
    assert.deepEqual(calls, [], "the recorded draft order answers on its own");
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      1,
    );
  });
});

describe("a Shopify write with no Admin API on a merchant store", () => {
  before(reset);
  after(reset);

  it("refuses the draft order and leaves the claim free for the retry", async () => {
    const { requestId, itemId } = await offeredFromStock({ target: merchantShop });
    await answerFromStock(requestId, itemId, "accept", merchantShop);

    const failed = await createPaymentLinkForRequest({ shop: merchantShop, requestId });
    assert.equal(failed.ok, false);

    // Nothing exists in Shopify, so the claim must not sit in the way of the
    // merchant's retry for the rest of its window.
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      0,
    );
  });
});
