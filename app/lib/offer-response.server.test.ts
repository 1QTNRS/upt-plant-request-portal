import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { handleCustomerOfferAction } from "./offer-response.server";
import {
  getCustomerResponse,
  getDraftOrder,
  parseDraftOrderLineItems,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
} from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-offer-response-test`;

async function purge() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

/** A sent offer with two available plants and one the shop cannot supply. */
async function offeredRequest() {
  const created = await submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [
      { plantName: "Monstera Albo" },
      { plantName: "Hoya Callistophylla" },
      { plantName: "Missing Fern" },
    ],
  });
  const [first, second, missing] = created.items;

  for (const [item, price] of [
    [first, 250],
    [second, 70],
  ] as const) {
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: item.id,
      availability: "available",
      price,
      weightLbs: 2,
    });
  }
  await updateRequestItem(shop, {
    requestId: created.id,
    itemId: missing.id,
    availability: "not_available",
    unavailableReason: "not in our current inventory",
  });
  await sendOffer(shop, created.id, 3);

  return { requestId: created.id, first, second, missing };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("an offer answer must be deliberate", () => {
  before(purge);
  after(purge);

  it("refuses a submission that leaves an available plant unanswered", async () => {
    // `required` on the radios is a browser guard; anything can post a form.
    const { requestId, first, second } = await offeredRequest();

    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      "missingChoices" in result ? result.missingChoices : null,
      ["Hoya Callistophylla"],
    );
    assert.match(
      ("error" in result ? result.error : "") ?? "",
      /Choose Accept or Reject for Hoya Callistophylla/,
    );

    // Nothing recorded, so the customer can still answer properly.
    assert.equal(await getCustomerResponse(shop, requestId), null);
    assert.equal(await getDraftOrder(shop, requestId), null);
    void second;
  });

  it("names every unanswered plant, not just the first", async () => {
    const { requestId } = await offeredRequest();
    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "submit-response" }),
    });

    assert.deepEqual(
      "missingChoices" in result ? result.missingChoices : null,
      ["Monstera Albo", "Hoya Callistophylla"],
    );
  });

  it("ignores a forged choice for a plant the shop marked unavailable", async () => {
    const { requestId, first, second, missing } = await offeredRequest();

    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        [`choice-${second.id}`]: "reject",
        [`choice-${missing.id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    assert.equal(result.ok, true);

    const response = await getCustomerResponse(shop, requestId);
    assert.equal(
      response?.items.find((item) => item.sourceItemId === missing.id)?.choice,
      "unavailable",
      "availability comes from the offer, never from the form",
    );

    // Only the accepted plant reaches the draft order.
    const draft = await getDraftOrder(shop, requestId);
    const titles = parseDraftOrderLineItems(draft?.lineItemsJson ?? "[]").map(
      (line) => line.title,
    );
    assert.ok(titles.includes("Monstera Albo"));
    assert.ok(!titles.includes("Hoya Callistophylla"));
    assert.ok(!titles.includes("Missing Fern"));
  });

  it("accepts a fully answered submission", async () => {
    const { requestId, first, second } = await offeredRequest();
    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "reject",
        [`choice-${second.id}`]: "reject",
        fedexUpgradeSelected: "true",
      }),
    });

    assert.equal(result.ok, true);
    const response = await getCustomerResponse(shop, requestId);
    assert.equal(
      response?.items.filter((item) => item.choice === "reject").length,
      2,
    );
    // Nothing accepted, so no draft order.
    assert.equal(await getDraftOrder(shop, requestId), null);
  });
});
