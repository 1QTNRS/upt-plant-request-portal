import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerOfferView } from "../components/customer-offer-view";
import {
  formatDateTime,
  getOfferHoldMessage,
  getOfferUrgencyMessage,
  type CustomerOfferResponse,
  type OfferPlantItem,
  type SampleCustomerOffer,
} from "./portal";

/*
 * These pages are rendered on the storefront through the app proxy, where the
 * client bundle never loads. Asserting on the server-rendered HTML is therefore
 * asserting on everything the customer actually gets.
 */

const PHOTOS = [
  "https://cdn.shopify.com/monstera-front.jpg",
  "https://cdn.shopify.com/monstera-back.jpg",
  "https://cdn.shopify.com/monstera-roots.jpg",
];

function plant(overrides: Partial<OfferPlantItem> = {}): OfferPlantItem {
  return {
    id: "offer-req-1",
    sourceItemId: "item-1",
    plantName: "Monstera Albo",
    price: 250,
    photoUrl: PHOTOS[0],
    photoUrls: PHOTOS,
    notesFromUpt: "One older leaf has a small scar.",
    quantity: 1,
    availability: "available",
    ...overrides,
  };
}

function offer(input: {
  expiresAt: Date;
  items?: OfferPlantItem[];
}): SampleCustomerOffer {
  const expiresAt = formatDateTime(input.expiresAt);
  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: 3,
    expiresAt,
    expiresAtIso: input.expiresAt.toISOString(),
    urgencyMessage: getOfferUrgencyMessage(),
    holdMessage: getOfferHoldMessage(expiresAt),
    fedexUpgradeLabel: "FedEx Priority Overnight Upgrade",
    fedexUpgradePrice: 15,
    customerEmail: "alex.rivera@example.com",
    customerName: "Alex Rivera",
    requestNumber: "REQ1",
    items: input.items ?? [plant()],
  };
}

function answer(
  choices: Array<{ plantName: string; choice: "accept" | "reject" | "unavailable" }>,
): CustomerOfferResponse {
  return {
    requestId: "req-1",
    requestNumber: "REQ1",
    customerName: "Alex Rivera",
    customerEmail: "alex.rivera@example.com",
    respondedAt: "Aug 20, 2026, 9:00 AM UTC",
    respondedAtIso: new Date().toISOString(),
    fedexUpgradeSelected: true,
    fedexUpgradePrice: 15,
    hasAcceptedPurchasableItems: choices.some((entry) => entry.choice === "accept"),
    items: choices.map((entry, index) => ({
      offerItemId: `response-item-${index}`,
      sourceItemId: `item-${index + 1}`,
      plantName: entry.plantName,
      choice: entry.choice,
      price: 250,
      quantity: 1,
      lineRevenue: entry.choice === "accept" ? 250 : 0,
      customerNotes: "One older leaf has a small scar.",
      photoUrls: PHOTOS,
    })),
  };
}

function render(props: Parameters<typeof CustomerOfferView>[0]): string {
  return renderToStaticMarkup(createElement(CustomerOfferView, props));
}

const inThreeDays = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("an expired offer is not presented as a live one", () => {
  const expired = render({
    offer: offer({ expiresAt: yesterday() }),
    response: null,
    fedexRemovalWarning: "",
    requestClosed: false,
    formAction: "/apps/plant-requests/requests/req-1",
    backHref: "/apps/plant-requests",
  });

  it("says the hold has ended instead of counting down to it", () => {
    assert.match(expired, /This offer has expired/);
    assert.ok(!expired.includes("Offer expires in"));
    assert.ok(!expired.includes(getOfferUrgencyMessage()));
    assert.ok(
      !expired.includes("being held for you"),
      "the plant is an EXACT PLANTS candidate the moment the hold ends",
    );
  });

  it("removes every control that would record an answer", () => {
    assert.ok(!expired.includes('type="radio"'), "nothing left to accept");
    assert.ok(!expired.includes('value="submit-response"'));
    assert.ok(!expired.includes('name="fedexUpgradeSelected"'));
    assert.ok(!expired.includes("<form"));
  });

  it("still shows what was offered, and the way back", () => {
    assert.match(expired, /Monstera Albo/);
    assert.match(expired, /no longer held for you/);
    assert.match(expired, /Back to My Requests/);
  });

  it("keeps the answer form while the hold is live", () => {
    const live = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(live, /Offer expires in 3 days/);
    assert.match(live, /type="radio"/);
    assert.match(live, /value="submit-response"/);
  });
});

describe("the customer sees every photo of each plant", () => {
  it("renders one plain image per frozen photo", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    for (const url of PHOTOS) {
      assert.ok(html.includes(url), `${url} is missing from the offer page`);
    }
    assert.equal([...html.matchAll(/<img/g)].length, PHOTOS.length);
    // A lightbox opened by onClick is unreachable on the storefront.
    assert.ok(!html.includes("onclick"));
  });

  it("shows an unavailable plant without photos, as the offer froze it", () => {
    const html = render({
      offer: offer({
        expiresAt: inThreeDays(),
        items: [
          plant({
            plantName: "String of Pearls",
            availability: "not_available",
            unavailableReason: "not in our current inventory",
            photoUrls: [],
            photoUrl: "",
          }),
        ],
      }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.equal([...html.matchAll(/<img/g)].length, 0);
    assert.match(html, /Not Available/);
  });
});

describe("a paid request acknowledges the payment", () => {
  const paid = render({
    offer: offer({ expiresAt: yesterday() }),
    response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
    invoiceUrl: "https://upt.myshopify.com/invoice/abc",
    fedexRemovalWarning: "",
    requestClosed: true,
    requestPaid: true,
    paidAt: "Aug 20, 2026, 10:00 AM UTC",
  });

  it("confirms the payment rather than asking for it again", () => {
    assert.match(paid, /Payment received/);
    assert.match(paid, /We received your payment on Aug 20, 2026/);
  });

  it("does not offer a checkout link for something already paid", () => {
    assert.ok(!paid.includes("Continue to Checkout"));
    assert.ok(!paid.includes("private checkout link"));
    assert.ok(!paid.includes("https://upt.myshopify.com/invoice/abc"));
  });

  it("keeps the checkout link while payment is still outstanding", () => {
    const unpaid = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: "https://upt.myshopify.com/invoice/abc",
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.match(unpaid, /Continue to Checkout/);
    assert.match(unpaid, /https:\/\/upt\.myshopify\.com\/invoice\/abc/);
  });

  it("withdraws the checkout link from a request closed without payment", () => {
    const closed = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: "https://upt.myshopify.com/invoice/abc",
      fedexRemovalWarning: "",
      requestClosed: true,
    });

    assert.match(closed, /Request closed/);
    assert.ok(!closed.includes("Continue to Checkout"));
    assert.ok(
      !closed.includes("still held for you"),
      "a closed request holds nothing",
    );
  });
});

describe("a request with nothing to pay for still has a way out", () => {
  it("offers to close a request where nothing was available", () => {
    const html = render({
      offer: offer({
        expiresAt: inThreeDays(),
        items: [
          plant({
            plantName: "String of Pearls",
            availability: "not_available",
            unavailableReason: "not in our current inventory",
            photoUrls: [],
            photoUrl: "",
          }),
        ],
      }),
      response: answer([{ plantName: "String of Pearls", choice: "unavailable" }]),
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(html, /Nothing to pay for/);
    assert.match(html, /value="close-request"/);
    assert.match(html, /action="\/apps\/plant-requests\/requests\/req-1"/);
  });

  it("offers to close a request where the customer rejected everything", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "reject" }]),
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(html, /No checkout link will be created/);
    assert.match(html, /value="close-request"/);
  });

  it("stops offering to close a request that is already closed", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "reject" }]),
      fedexRemovalWarning: "",
      requestClosed: true,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.ok(!html.includes('value="close-request"'));
  });
});

describe("the customer is not shown internal email copy", () => {
  it("has no confirmation email preview on the answered page", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "reject" }]),
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.ok(!html.includes("Confirmation email preview"));
    assert.ok(!html.includes("To: alex.rivera@example.com"));
    assert.ok(
      !html.includes("Accepted items"),
      "the email body claimed accepted items on a rejected offer",
    );
  });
});

describe("a hold that lapsed before payment", () => {
  const lapsed = render({
    offer: offer({ expiresAt: yesterday() }),
    response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
    invoiceUrl: "https://upt.myshopify.com/invoice/abc",
    fedexRemovalWarning: "",
    requestClosed: false,
  });

  it("stops claiming the plants are still held", () => {
    // An expired unpaid request releases its plants for EXACT PLANTS review,
    // so promising they are reserved is a promise this page cannot keep.
    assert.match(lapsed, /Your hold ended/);
    assert.match(lapsed, /contact us before paying/);
    assert.ok(!lapsed.includes("still held for you"));
    assert.ok(!lapsed.includes("emailed this link to you just in case"));
  });

  it("leaves the invoice reachable, because Shopify will still take it", () => {
    assert.match(lapsed, /Continue to Checkout/);
  });

  it("says nothing about a lapsed hold while the offer is live", () => {
    const live = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: "https://upt.myshopify.com/invoice/abc",
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.ok(!live.includes("Your hold ended"));
    assert.match(live, /emailed this link to you just in case/);
  });
});
