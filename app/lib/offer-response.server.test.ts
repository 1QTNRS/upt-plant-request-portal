import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  createPaymentLinkForRequest,
  handleCustomerOfferAction,
} from "./offer-response.server";
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
// Not a demo shop, so a Shopify write with no Admin client is refused rather
// than stubbed — which is how a real draft-order failure behaves.
const merchantShop = "offer-response-merchant.myshopify.com";

async function purgeShop(target: string) {
  await prisma.emailMessage.deleteMany({ where: { shop: target } });
  await prisma.plantRequest.deleteMany({ where: { shop: target } });
  await prisma.customerProfile.deleteMany({ where: { shop: target } });
  await prisma.shopSettings.deleteMany({ where: { shop: target } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop: target } });
}

async function purge() {
  await purgeShop(shop);
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

describe("an offer that lapses while the customer is answering", () => {
  before(purge);
  after(purge);

  it("tells the customer rather than crashing on them", async () => {
    const { requestId, first, second } = await offeredRequest();

    // Reading the request runs the expiry sweep, so a customer submitting as
    // their hold lapses expires their own offer. The reminder email exists to
    // make people answer at the last minute, so this is the expected shape.
    await prisma.offer.update({
      where: { requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        [`choice-${second.id}`]: "reject",
        fedexUpgradeSelected: "true",
      }),
    });

    assert.equal(result.ok, false);
    assert.match(
      "error" in result && result.error ? result.error : "",
      /expired before your answer reached us/,
    );
    // Nothing was recorded, so the plant is released rather than half-sold.
    assert.equal(await getCustomerResponse(shop, requestId), null);
  });
});

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

describe("a failed draft order is not presented as a confirmed order", () => {
  before(() => purgeShop(merchantShop));
  after(() => purgeShop(merchantShop));

  /** One available plant, offered, on a shop with no Admin API client. */
  async function acceptedWithoutShopify() {
    const created = await submitCustomerRequest(merchantShop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Monstera Albo" }],
    });
    await updateRequestItem(merchantShop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "available",
      price: 250,
      weightLbs: 2,
    });
    await sendOffer(merchantShop, created.id, 3);

    const result = await handleCustomerOfferAction({
      shop: merchantShop,
      requestId: created.id,
      form: form({
        intent: "submit-response",
        [`choice-${created.items[0].id}`]: "accept",
        fedexUpgradeSelected: "true",
      }),
    });
    return { created, result };
  }

  it("keeps the customer's choices and reports that no payment link exists", async () => {
    const { created, result } = await acceptedWithoutShopify();

    assert.equal(result.ok, true);
    assert.equal(
      "draftOrderFailed" in result ? result.draftOrderFailed : null,
      true,
      "the caller has to be able to tell the customer the truth",
    );
    // The choices are committed either way; only the payment link is missing.
    const response = await getCustomerResponse(merchantShop, created.id);
    assert.equal(response?.items[0].choice, "accept");
    assert.equal(await getDraftOrder(merchantShop, created.id), null);

    const confirmation = await prisma.emailMessage.findFirstOrThrow({
      where: { shop: merchantShop, requestId: created.id, templateKey: "confirmation" },
    });
    assert.ok(
      !confirmation.bodyText.includes("Checkout / payment link"),
      "there is no link to put in it",
    );
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop: merchantShop, requestId: created.id, templateKey: "checkout_link" },
      }),
      0,
    );
  });

  it("tells the admin why the payment link could not be created", async () => {
    const { created } = await acceptedWithoutShopify();

    const result = await createPaymentLinkForRequest({
      shop: merchantShop,
      requestId: created.id,
    });

    assert.equal(result.ok, false);
    assert.match(
      "error" in result ? result.error : "",
      /Could not create the payment link/,
    );
  });
});

describe("the admin can create a missing payment link", () => {
  before(purge);
  after(purge);

  /** The state a failed draft order leaves behind: accepted, but unpayable. */
  async function acceptedWithNoDraftOrder() {
    const { requestId, first, second } = await offeredRequest();
    await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        [`choice-${second.id}`]: "reject",
        fedexUpgradeSelected: "true",
      }),
    });
    await prisma.draftOrderReference.deleteMany({ where: { requestId } });
    await prisma.emailMessage.deleteMany({
      where: { shop, requestId, templateKey: "checkout_link" },
    });
    return requestId;
  }

  it("creates the draft order and emails the link", async () => {
    const requestId = await acceptedWithNoDraftOrder();

    const result = await createPaymentLinkForRequest({ shop, requestId });

    assert.equal(result.ok, true);
    const draft = await getDraftOrder(shop, requestId);
    assert.equal(draft?.invoiceUrl, "ok" in result && result.ok ? result.invoiceUrl : null);

    // `confirmation:{requestId}` was already used, so the link needs its own key.
    const email = await prisma.emailMessage.findFirstOrThrow({
      where: { shop, requestId, templateKey: "checkout_link" },
    });
    assert.equal(email.idempotencyKey, `checkout_link:${requestId}`);
    assert.ok(email.bodyText.includes(draft!.invoiceUrl!));
  });

  it("bills only for the accepted plant, however often it is run", async () => {
    const requestId = await acceptedWithNoDraftOrder();

    const first = await createPaymentLinkForRequest({ shop, requestId });
    const second = await createPaymentLinkForRequest({ shop, requestId });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(
      await prisma.draftOrderReference.count({ where: { requestId } }),
      1,
      "a retry must never bill the customer twice",
    );

    const draft = await getDraftOrder(shop, requestId);
    const titles = parseDraftOrderLineItems(draft?.lineItemsJson ?? "[]").map(
      (line) => line.title,
    );
    assert.ok(titles.includes("Monstera Albo"));
    assert.ok(!titles.includes("Hoya Callistophylla"), "rejected plants stay out");
  });

  it("refuses a request on which the customer accepted nothing", async () => {
    const { requestId, first, second } = await offeredRequest();
    await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "reject",
        [`choice-${second.id}`]: "reject",
        fedexUpgradeSelected: "true",
      }),
    });

    const result = await createPaymentLinkForRequest({ shop, requestId });

    assert.equal(result.ok, false);
    assert.match(
      "error" in result ? result.error : "",
      /only created for accepted plants/,
    );
    assert.equal(await getDraftOrder(shop, requestId), null);
  });

  it("refuses a request the customer has not answered", async () => {
    const { requestId } = await offeredRequest();
    const result = await createPaymentLinkForRequest({ shop, requestId });

    assert.equal(result.ok, false);
    assert.match("error" in result ? result.error : "", /has not answered/);
  });
});
