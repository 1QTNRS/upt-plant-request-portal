import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { exactPlantReleaseReason } from "./exact-plants";
import {
  closeDeclinedRequest,
  createPaymentLinkForRequest,
  handleCustomerOfferAction,
  loadCustomerOfferPage,
} from "./offer-response.server";
import { formatCustomerStatusLabel } from "./portal";
import {
  closeRequest,
  expireOverdueOffers,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  listCustomerRequests,
  listRequests,
  markRequestPaid,
  parseDraftOrderLineItems,
  sendOffer,
  submitCustomerRequest,
  updateRequestItem,
  updateShopSettings,
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
      customerFacingNotes: `Notes for ${item.plantName}.`,
      photoUrls: [`https://cdn.example.com/${item.id}.jpg`],
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
      photoUrls: ["https://cdn.example.com/monstera.jpg"],
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

/**
 * The stored status stays Pending on purpose. Closing a request whose customer
 * rejected everything would take its declined plant out of the EXACT PLANTS
 * review queue, because `exactPlantReleaseReason` requires an open request.
 */
describe("what the customer is told is owed", () => {
  before(purge);
  after(purge);

  /** An offer where UPT could supply nothing at all. */
  async function nothingAvailable() {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Philodendron Spiritus Sancti" }],
    });
    await updateRequestItem(shop, {
      requestId: created.id,
      itemId: created.items[0].id,
      availability: "not_available",
      unavailableReason: "not in our current inventory",
    });
    await sendOffer(shop, created.id, 3);
    return created.id;
  }

  const labelOf = (request: Awaited<ReturnType<typeof getRequest>>) =>
    formatCustomerStatusLabel(request!.status, {
      hasPayableItems: request!.hasPayableItems,
      hasResponded: request!.hasResponded,
    });

  it("presents an unanswered offer as something to read, not a bill", async () => {
    const { requestId } = await offeredRequest();
    const request = await getRequest(shop, requestId);

    assert.equal(request?.status, "Pending");
    assert.equal(request?.hasPayableItems, true);
    assert.equal(request?.hasResponded, false);
    assert.equal(labelOf(request), "Offer Ready for Review");
  });

  it("asks for payment once the customer has accepted something", async () => {
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

    const request = await getRequest(shop, requestId);
    assert.equal(request?.status, "Pending");
    assert.equal(request?.hasResponded, true);
    assert.equal(labelOf(request), "Needs Payment");
  });

  it("stops asking for payment once every plant was rejected", async () => {
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

    const request = await getRequest(shop, requestId);
    assert.equal(request?.status, "Pending", "the declined plant stays reviewable");
    assert.equal(request?.hasPayableItems, false);
    assert.equal(labelOf(request), "No Payment Needed");
  });

  it("never asks for payment on an offer with nothing available", async () => {
    const requestId = await nothingAvailable();
    const request = await getRequest(shop, requestId);

    assert.equal(request?.status, "Pending");
    assert.equal(request?.hasPayableItems, false);
    assert.equal(labelOf(request), "No Payment Needed");
  });

  it("carries the same answer into the customer's own request list", async () => {
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

    const rows = await listCustomerRequests(shop, {
      email: "alex.rivera@example.com",
    });
    const row = rows.find((entry) => entry.id === requestId);

    assert.equal(row?.hasPayableItems, false);
    assert.equal(row?.hasResponded, true);
    assert.equal(
      formatCustomerStatusLabel(row!.status, {
        hasPayableItems: row!.hasPayableItems,
        hasResponded: row!.hasResponded,
      }),
      "No Payment Needed",
      "the list and the detail page must say the same thing",
    );
  });

  it("keeps the stored status among the four that exist", async () => {
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

    const stored = await prisma.plantRequest.findFirstOrThrow({
      where: { id: requestId, shop },
    });
    assert.ok(["New", "Pending", "Closed", "Expired"].includes(stored.status));
  });

  it("says nothing about payment before an offer has been sent", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Hoya Lacunosa" }],
    });
    const request = await getRequest(shop, created.id);

    assert.equal(request?.status, "New");
    assert.equal(request?.hasPayableItems, undefined);
    assert.equal(request?.hasResponded, false);
  });
});

describe("the customer offer page", () => {
  before(purge);
  after(purge);

  it("never hands the customer the internal confirmation email", async () => {
    // It contained their address, the subject line, the whole body and the
    // payment link, and on a rejected offer it asserted accepted items.
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

    const page = await loadCustomerOfferPage(shop, requestId);
    assert.ok(!("confirmationEmail" in page));
    assert.ok(page.response);
  });

  it("reports a paid request as paid rather than as awaiting checkout", async () => {
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

    const beforePayment = await loadCustomerOfferPage(shop, requestId);
    assert.equal(beforePayment.requestPaid, false);
    assert.equal(beforePayment.requestClosed, false);
    assert.ok(beforePayment.invoiceUrl);

    await markRequestPaid(shop, requestId, {
      shopifyOrderGid: "gid://shopify/Order/1",
      orderNumber: "#1001",
      plantRevenue: 250,
    });

    const afterPayment = await loadCustomerOfferPage(shop, requestId);
    assert.equal(afterPayment.requestPaid, true);
    assert.equal(afterPayment.requestClosed, true);
    assert.ok(afterPayment.paidAt, "the page states when the payment arrived");
  });
});

describe("a customer who accepts nothing", () => {
  before(purge);
  after(purge);

  /** Every available plant rejected, with the FedEx box left ticked. */
  async function rejectedEverything() {
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
    return { requestId, first, second };
  }

  it("has the upgrade recorded as unselected without being asked to untick it", async () => {
    const { requestId } = await rejectedEverything();

    const response = await getCustomerResponse(shop, requestId);
    assert.equal(
      response?.fedexUpgradeSelected,
      false,
      "there is no shipment to upgrade",
    );
  });

  it("gets no draft order, no FedEx line and no checkout link", async () => {
    const { requestId } = await rejectedEverything();

    assert.equal(await getDraftOrder(shop, requestId), null);
    const page = await loadCustomerOfferPage(shop, requestId);
    assert.equal(page.invoiceUrl, null);
  });

  it("can still read the whole offer back from the frozen snapshot", async () => {
    const { requestId, first } = await rejectedEverything();

    // A later admin edit must not be able to rewrite what they were shown.
    await prisma.requestItem.update({
      where: { id: first.id },
      data: {
        offeredName: "Renamed After The Fact",
        price: 9999,
        customerFacingNotes: "Rewritten notes.",
      },
    });
    await prisma.photoReference.deleteMany({ where: { itemId: first.id } });

    const response = await getCustomerResponse(shop, requestId);
    const declined = response?.items.find((item) => item.sourceItemId === first.id);

    assert.equal(declined?.choice, "reject");
    assert.equal(declined?.plantName, "Monstera Albo");
    assert.equal(declined?.price, 250);
    assert.equal(declined?.customerNotes, "Notes for Monstera Albo.");
    assert.deepEqual(declined?.photoUrls, [
      `https://cdn.example.com/${first.id}.jpg`,
    ]);
  });

  it("keeps the two-step FedEx confirmation for a customer who accepted something", async () => {
    const { requestId, first, second } = await offeredRequest();

    const held = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        [`choice-${second.id}`]: "reject",
        fedexRemovalAcknowledged: "true",
      }),
    });

    assert.equal(held.ok, true);
    const response = await getCustomerResponse(shop, requestId);
    assert.equal(response?.fedexUpgradeSelected, false);
    const draft = await getDraftOrder(shop, requestId);
    const kinds = parseDraftOrderLineItems(draft?.lineItemsJson ?? "[]").map(
      (line) => line.kind,
    );
    assert.deepEqual(kinds, ["plant"], "the removed upgrade is not billed");
  });
});

describe("closing a request the customer declined outright", () => {
  before(purge);
  after(purge);

  async function declinedRequest() {
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
    return { requestId, first };
  }

  it("closes it, timestamps it, and creates nothing to pay", async () => {
    const { requestId } = await declinedRequest();

    assert.deepEqual(await closeDeclinedRequest({ shop, requestId }), { ok: true });

    const request = await getRequest(shop, requestId);
    assert.equal(request?.status, "Closed");
    assert.ok(request?.closedAt);
    assert.equal(await getDraftOrder(shop, requestId), null);

    const page = await loadCustomerOfferPage(shop, requestId);
    assert.equal(page.requestClosed, true);
    assert.equal(page.requestPaid, false);
    assert.equal(page.invoiceUrl, null);
    // The customer can still open it and read what they declined.
    assert.equal(page.response?.items.length, 3);
  });

  it("shows Closed to the admin dashboard and the customer's list at once", async () => {
    const { requestId } = await declinedRequest();
    await closeDeclinedRequest({ shop, requestId });

    const dashboard = await listRequests(shop);
    assert.equal(
      dashboard.find((entry) => entry.id === requestId)?.status,
      "Closed",
    );

    const rows = await listCustomerRequests(shop, {
      email: "alex.rivera@example.com",
    });
    const row = rows.find((entry) => entry.id === requestId);
    assert.equal(row?.status, "Closed");
    assert.equal(
      formatCustomerStatusLabel(row!.status, {
        hasPayableItems: row!.hasPayableItems,
        hasResponded: row!.hasResponded,
      }),
      "Closed",
    );
  });

  it("keeps the declined history and its analytics after closing", async () => {
    const { requestId, first } = await declinedRequest();
    await closeDeclinedRequest({ shop, requestId });

    const response = await getCustomerResponse(shop, requestId);
    const declined = response?.items.find((item) => item.sourceItemId === first.id);
    assert.equal(declined?.choice, "reject");
    assert.equal(declined?.price, 250);
    assert.equal(declined?.customerNotes, "Notes for Monstera Albo.");
  });

  /*
   * Deliberate and flagged rather than worked around: `exactPlantReleaseReason`
   * refuses a Closed request, so closing here takes the declined plants out of
   * the EXACT PLANTS review queue. The admin page says so before the button is
   * pressed. Changing that rule is not this change's call to make.
   */
  it("takes its declined plants out of the EXACT PLANTS review queue", async () => {
    const { requestId, first } = await declinedRequest();

    assert.equal(
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "reject",
        requestStatus: (await getRequest(shop, requestId))!.status,
      }),
      "customer_declined",
    );

    await closeDeclinedRequest({ shop, requestId });

    assert.equal(
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "reject",
        requestStatus: (await getRequest(shop, requestId))!.status,
      }),
      null,
    );
    void first;
  });

  it("refuses to close a request the customer accepted something on", async () => {
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

    const result = await closeDeclinedRequest({ shop, requestId });
    assert.equal(result.ok, false);
    assert.match("error" in result ? result.error : "", /accepted plants/);
    assert.equal((await getRequest(shop, requestId))?.status, "Pending");
  });

  it("refuses to close a request the customer has not answered", async () => {
    const { requestId } = await offeredRequest();

    const result = await closeDeclinedRequest({ shop, requestId });
    assert.equal(result.ok, false);
    assert.match("error" in result ? result.error : "", /has not answered/);
    assert.equal((await getRequest(shop, requestId))?.status, "Pending");
  });
});

describe("what a submitted response puts in the outbox", () => {
  before(async () => {
    await purge();
    await updateShopSettings(shop, { adminNotificationEmail: "upt@example.com" });
  });
  after(purge);

  const emailsFor = (requestId: string) =>
    prisma.emailMessage.findMany({
      where: { shop, requestId },
      orderBy: { createdAt: "asc" },
    });

  it("sends one customer email and one admin email when plants are accepted", async () => {
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

    const emails = await emailsFor(requestId);
    assert.deepEqual(
      emails.map((email) => email.templateKey).sort(),
      ["admin_response", "confirmation"],
      "no separate checkout-link email, and never one per item",
    );

    const summary = emails.find((email) => email.templateKey === "confirmation")!;
    const draft = await getDraftOrder(shop, requestId);
    assert.match(summary.bodyText, /Accepted:\n- Monstera Albo — \$250\.00/);
    assert.match(summary.bodyText, /Declined:\n- Hoya Callistophylla — \$70\.00/);
    assert.match(summary.bodyText, /FedEx Priority Overnight Upgrade: kept/);
    assert.ok(summary.bodyText.includes(draft!.invoiceUrl!));
    assert.equal(summary.toEmail, "alex.rivera@example.com");

    const admin = emails.find((email) => email.templateKey === "admin_response")!;
    assert.equal(admin.toEmail, "upt@example.com");
    assert.match(admin.subject, /customer responded/);
    assert.match(admin.subject, /1 of 2 item\(s\) accepted/);
  });

  it("still sends exactly one of each when everything is declined", async () => {
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

    const emails = await emailsFor(requestId);
    assert.deepEqual(
      emails.map((email) => email.templateKey).sort(),
      ["admin_response", "confirmation"],
    );

    const summary = emails.find((email) => email.templateKey === "confirmation")!;
    assert.match(summary.subject, /no payment needed/i);
    assert.doesNotMatch(summary.bodyText, /FedEx/);
    assert.doesNotMatch(summary.bodyText, /invoice|checkout/i);

    const admin = emails.find((email) => email.templateKey === "admin_response")!;
    assert.match(admin.subject, /every item declined/);
  });

  it("cannot be duplicated by a retry or a double submit", async () => {
    const { requestId, first, second } = await offeredRequest();
    const submit = () =>
      handleCustomerOfferAction({
        shop,
        requestId,
        form: form({
          intent: "submit-response",
          [`choice-${first.id}`]: "accept",
          [`choice-${second.id}`]: "reject",
          fedexUpgradeSelected: "true",
        }),
      });

    await submit();
    const again = await submit();

    assert.equal("alreadySubmitted" in again ? again.alreadySubmitted : null, true);
    const emails = await emailsFor(requestId);
    assert.equal(emails.length, 2);
    assert.deepEqual(
      emails.map((email) => email.idempotencyKey).sort(),
      [`admin_response:${requestId}`, `confirmation:${requestId}`],
    );
  });

  it("tells UPT nothing about an offer nobody has answered", async () => {
    const { requestId } = await offeredRequest();
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId, templateKey: "admin_response" },
      }),
      0,
    );
  });
});

describe("a request that is already closed", () => {
  before(purge);
  after(purge);

  it("refuses an answer instead of billing for it", async () => {
    const { requestId, first, second } = await offeredRequest();
    await closeRequest(shop, requestId, "Customer closed request");

    // Reachable by posting a stale tab: the customer's own page shows the
    // request as closed and offers no controls.
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
      /already closed/,
    );
    assert.equal(await getCustomerResponse(shop, requestId), null);
    assert.equal(await getDraftOrder(shop, requestId), null);
    assert.equal(
      await prisma.emailMessage.count({
        where: { shop, requestId, templateKey: { in: ["confirmation", "checkout_link"] } },
      }),
      0,
      "no confirmation and no payment link for a closed request",
    );
  });

  it("refuses an answer to an offer that expired and was then closed", async () => {
    const { requestId, first, second } = await offeredRequest();
    await prisma.offer.update({
      where: { requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expireOverdueOffers(shop);
    await closeRequest(shop, requestId, "Customer closed request");

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
    assert.equal(await getDraftOrder(shop, requestId), null);
  });
});
