import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import { exactPlantReleaseReason } from "./exact-plants";
import { listExactPlantCandidates } from "./exact-plants.server";
import {
  adminOverrideCloseRequest,
  closeDeclinedRequest,
  createPaymentLinkForRequest,
  handleCustomerOfferAction,
  loadCustomerOfferPage,
} from "./offer-response.server";
import {
  ADMIN_OVERRIDE_CLOSE_REASON,
  CUSTOMER_CLOSED_REQUEST_REASON,
  INVOICE_VOIDED_BY_ADMIN_REASON,
  INVOICE_VOIDED_BY_CUSTOMER_CLOSE_REASON,
  adminDraftOrderLinkState,
  formatCustomerStatusLabel,
} from "./portal";
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

    assert.equal(
      await prisma.emailMessage.count({
        where: {
          shop: merchantShop,
          requestId: created.id,
          templateKey: { in: ["confirmation", "checkout_link"] },
        },
      }),
      0,
      "Accept does not send a customer confirmation or checkout email",
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
 * A purchasable offer stays Pending until something closes or expires it.
 * An offer with nothing to buy closes immediately. Closing a declined
 * request must not take its Exact Plants out of the EXACT PLANTS review
 * queue — `exactPlantReleaseReason` still returns `customer_declined` on a
 * Closed unpaid request.
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

    assert.equal(request?.status, "Closed");
    assert.equal(request?.hasPayableItems, false);
    assert.equal(labelOf(request), "Closed");
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

  it("refuses a crafted POST that removes FedEx without acknowledgement", async () => {
    const { requestId, first, second } = await offeredRequest();

    const blocked = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({
        intent: "submit-response",
        [`choice-${first.id}`]: "accept",
        [`choice-${second.id}`]: "reject",
      }),
    });

    assert.equal(blocked.ok, false);
    assert.equal(
      "pendingFedexRemoval" in blocked && blocked.pendingFedexRemoval,
      true,
    );
    assert.equal(await getCustomerResponse(shop, requestId), null);
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

  it("keeps its declined plants in the EXACT PLANTS review queue", async () => {
    const { requestId, first } = await declinedRequest();

    const reason = async () =>
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "reject",
        requestStatus: (await getRequest(shop, requestId))!.status,
      });

    assert.equal(await reason(), "customer_declined");

    // Closing is how an admin tidies away a request the customer wanted nothing
    // from. It must not also throw away the plants that are now for sale.
    await closeDeclinedRequest({ shop, requestId });

    assert.equal(await reason(), "customer_declined");
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

describe("customer Close Request after decline-all", () => {
  before(purge);
  after(purge);

  it("refuses to close before the customer has answered", async () => {
    const { requestId } = await offeredRequest();
    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "close-request" }),
    });
    assert.equal(result.ok, false);
    assert.equal((await getRequest(shop, requestId))?.status, "Pending");
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: CUSTOMER_CLOSED_REQUEST_REASON },
      }),
      0,
    );
  });

  it("closes a No Payment Needed decline-all request and keeps history", async () => {
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

    const before = await getCustomerResponse(shop, requestId);
    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "close-request" }),
    });
    assert.equal(result.ok, true);
    assert.equal("closed" in result && result.closed, true);

    const request = await getRequest(shop, requestId);
    assert.equal(request?.status, "Closed");
    assert.ok(request?.closedAt);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: CUSTOMER_CLOSED_REQUEST_REASON },
      }),
      1,
    );

    const after = await getCustomerResponse(shop, requestId);
    assert.equal(after?.items.length, before?.items.length);
    assert.equal(
      after?.items.find((item) => item.sourceItemId === first.id)?.choice,
      "reject",
    );
    assert.equal(
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "reject",
        requestStatus: "Closed",
      }),
      "customer_declined",
    );
    const candidates = await listExactPlantCandidates(shop, requestId);
    assert.equal(candidates.some((row) => row.requestItemId === first.id), true);
    assert.equal(candidates.some((row) => row.requestItemId === second.id), true);
  });

  it("refuses to self-close a payment-required request", async () => {
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
    const result = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "close-request" }),
    });
    assert.equal(result.ok, false);
    assert.equal((await getRequest(shop, requestId))?.status, "Pending");
  });

  it("voids a leftover payable draft on a No Payment Needed close", async () => {
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
    await prisma.draftOrderReference.create({
      data: {
        requestId,
        invoiceUrl: "https://example.com/invoice/stale",
        shopifyDraftOrderGid: "gid://shopify/DraftOrder/stale",
      },
    });

    await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "close-request" }),
    });
    const draft = await getDraftOrder(shop, requestId);
    assert.ok(draft?.voidedAt);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: INVOICE_VOIDED_BY_CUSTOMER_CLOSE_REASON },
      }),
      1,
    );

    const again = await handleCustomerOfferAction({
      shop,
      requestId,
      form: form({ intent: "close-request" }),
    });
    assert.equal(again.ok, true);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: CUSTOMER_CLOSED_REQUEST_REASON },
      }),
      1,
    );
  });
});

describe("admin override close", () => {
  before(purge);
  after(purge);

  it("refuses to close until confirmation is posted", async () => {
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

    const result = await adminOverrideCloseRequest({
      shop,
      requestId,
      confirmed: false,
    });
    assert.equal(result.ok, false);
    assert.equal(
      "pendingAdminOverrideClose" in result && result.pendingAdminOverrideClose,
      true,
    );
    assert.equal((await getRequest(shop, requestId))?.status, "Pending");
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: ADMIN_OVERRIDE_CLOSE_REASON },
      }),
      0,
    );
  });

  it("closes an active request, timestamps it, and records Admin Override Close", async () => {
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
    const beforeResponse = await getCustomerResponse(shop, requestId);
    const beforeDraft = await getDraftOrder(shop, requestId);
    assert.ok(beforeDraft?.invoiceUrl);

    const result = await adminOverrideCloseRequest({
      shop,
      requestId,
      confirmed: true,
    });
    assert.deepEqual(result, { ok: true, alreadyClosed: false });

    const request = await getRequest(shop, requestId);
    assert.equal(request?.status, "Closed");
    assert.ok(request?.closedAt);
    assert.equal(request?.paidAt, undefined);

    const events = await prisma.statusEvent.findMany({
      where: { requestId },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(events.some((event) => event.reason === ADMIN_OVERRIDE_CLOSE_REASON));
    assert.ok(
      !events.some((event) => event.reason === "Payment completed"),
      "override close is not a paid closure",
    );

    const afterResponse = await getCustomerResponse(shop, requestId);
    assert.equal(afterResponse?.items.length, beforeResponse?.items.length);
    assert.equal(
      afterResponse?.items.find((item) => item.sourceItemId === first.id)?.choice,
      "accept",
    );
    assert.equal(
      afterResponse?.items.find((item) => item.sourceItemId === second.id)?.choice,
      "reject",
    );

    const draft = await getDraftOrder(shop, requestId);
    assert.ok(draft?.voidedAt);
    assert.ok(draft?.shopifyDraftOrderGid || draft?.invoiceUrl);
    assert.deepEqual(
      adminDraftOrderLinkState({
        shop,
        shopifyDraftOrderGid: draft?.shopifyDraftOrderGid,
        voidedAt: draft?.voidedAt,
      }),
      { kind: "voided" },
    );
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: INVOICE_VOIDED_BY_ADMIN_REASON },
      }),
      1,
    );
  });

  it("keeps a declined Exact Plant eligible and a declined Grower's Choice excluded", async () => {
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
    await prisma.offerItem.updateMany({
      where: { requestItemId: second.id },
      data: { fulfillmentType: "growers_choice" },
    });

    await adminOverrideCloseRequest({ shop, requestId, confirmed: true });

    const candidates = await listExactPlantCandidates(shop, requestId);
    assert.equal(candidates.some((row) => row.requestItemId === first.id), true);
    assert.equal(candidates.some((row) => row.requestItemId === second.id), false);
    assert.equal(
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        responseChoice: "reject",
        requestStatus: "Closed",
      }),
      "customer_declined",
    );
    assert.equal(
      exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: "available",
        offerFulfillmentType: "growers_choice",
        responseChoice: "reject",
        requestStatus: "Closed",
      }),
      null,
    );
  });

  it("is idempotent: a second override does not append another close event", async () => {
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

    await adminOverrideCloseRequest({ shop, requestId, confirmed: true });
    const closedAt = (await getRequest(shop, requestId))?.closedAtIso;
    const again = await adminOverrideCloseRequest({
      shop,
      requestId,
      confirmed: true,
    });
    assert.deepEqual(again, { ok: true, alreadyClosed: true });
    assert.equal((await getRequest(shop, requestId))?.closedAtIso, closedAt);
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: ADMIN_OVERRIDE_CLOSE_REASON },
      }),
      1,
    );
    assert.equal(
      await prisma.statusEvent.count({
        where: { requestId, reason: INVOICE_VOIDED_BY_ADMIN_REASON },
      }),
      1,
    );
  });

  it("can close a New request that has never been offered", async () => {
    const created = await submitCustomerRequest(shop, {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      items: [{ plantName: "Anthurium" }],
    });
    const result = await adminOverrideCloseRequest({
      shop,
      requestId: created.id,
      confirmed: true,
    });
    assert.deepEqual(result, { ok: true, alreadyClosed: false });
    assert.equal((await getRequest(shop, created.id))?.status, "Closed");
    assert.equal(await getDraftOrder(shop, created.id), null);
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

  it("emails UPT once when plants are accepted, and does not email the customer again", async () => {
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
      emails.map((email) => email.templateKey),
      ["admin_response"],
      "EMAIL 2 already went out at offer send; Accept does not add customer mail",
    );

    const draft = await getDraftOrder(shop, requestId);
    assert.ok(draft?.invoiceUrl, "the payment URL is still created for the portal");

    const admin = emails.find((email) => email.templateKey === "admin_response")!;
    assert.equal(admin.toEmail, "upt@example.com");
    assert.match(admin.subject, /customer responded/);
    assert.match(admin.subject, /1 of 2 item\(s\) accepted/);
  });

  it("still emails UPT once when everything is declined, with no customer mail", async () => {
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
      emails.map((email) => email.templateKey),
      ["admin_response"],
    );
    assert.equal(await getDraftOrder(shop, requestId), null);

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
    assert.equal(emails.length, 1);
    assert.deepEqual(emails.map((email) => email.idempotencyKey), [
      `admin_response:${requestId}`,
    ]);
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
