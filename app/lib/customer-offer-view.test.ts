import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerOfferView } from "../components/customer-offer-view";
import {
  CUSTOMER_SUPPORT_EMAIL,
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
    fulfillmentType: "exact_plant",
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
      fulfillmentType: "exact_plant" as const,
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
    assert.ok(!expired.includes('id="fedex-upgrade"'));
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
    assert.equal([...html.matchAll(/<img/g)].length, PHOTOS.length + 1);
    assert.match(html, /data-customer-photo/);
    assert.match(html, /data-customer-lightbox/);
    assert.match(html, /data-lightbox-prev/);
    assert.match(html, /data-lightbox-next/);
    assert.match(html, /data-lightbox-close/);
    // React onClick never reaches the storefront; the enhance script does.
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

    assert.equal([...html.matchAll(/<img/g)].length, 1);
    assert.match(html, /Not Available/);
  });
});

describe("a Grower's Choice plant on the customer's offer", () => {
  const LISTING_IMAGE = "https://cdn.shopify.com/listing-thai.jpg";

  const growersChoice = plant({
    plantName: "Monstera Thai Constellation",
    price: 285,
    fulfillmentType: "growers_choice",
    listingImageUrl: LISTING_IMAGE,
    listingProductTitle: "Monstera Thai Constellation",
    listingVariantTitle: "6 inch",
    listingVariantGid: "gid://shopify/ProductVariant/1",
    notesFromUpt: "Chosen by us from this listing.",
    photoUrls: [],
    photoUrl: "",
  });

  const html = render({
    offer: offer({ expiresAt: inThreeDays(), items: [growersChoice] }),
    response: null,
    fedexRemovalWarning: "",
    requestClosed: false,
    formAction: "/apps/plant-requests/requests/req-1",
  });

  it("shows the plant they asked for, the price and their notes", () => {
    assert.match(html, /Monstera Thai Constellation/);
    assert.match(html, /\$285\.00/);
    assert.match(html, /Chosen by us from this listing/);
  });

  it("labels the route rather than leaving the customer to infer it", () => {
    assert.match(html, /Grower&#x27;s Choice/);
  });

  it("says the photo is the listing's and not the plant they will receive", () => {
    // An exact-plant offer on the same page shows the very plant being bought,
    // so an unlabelled listing photo reads as the same promise.
    assert.ok(html.includes(LISTING_IMAGE));
    assert.match(html, /not of the plant you will receive/);
    assert.match(html, /similar but not identical to the one pictured/);
  });

  it("neither shows nor implies an exact plant photo", () => {
    assert.equal([...html.matchAll(/<img/g)].length, 2);
    for (const url of PHOTOS) {
      assert.ok(!html.includes(url), "an exact plant's photos are of one plant");
    }
  });

  it("can still be accepted or rejected", () => {
    assert.match(html, /value="accept"/);
    assert.match(html, /value="reject"/);
    assert.match(html, /value="submit-response"/);
    assert.ok(!html.includes("onclick"));
  });
});

describe("an answered Grower's Choice plant", () => {
  it("stays labelled in the record of what the customer answered", () => {
    const answered = answer([
      { plantName: "Monstera Thai Constellation", choice: "accept" },
    ]);
    const html = render({
      offer: offer({
        expiresAt: inThreeDays(),
        items: [
          plant({
            plantName: "Monstera Thai Constellation",
            fulfillmentType: "growers_choice",
            listingImageUrl: "https://cdn.shopify.com/listing-thai.jpg",
            photoUrls: [],
            photoUrl: "",
          }),
        ],
      }),
      response: {
        ...answered,
        items: answered.items.map((item) => ({
          ...item,
          fulfillmentType: "growers_choice" as const,
          linkedProductTitle: "Monstera Thai Constellation",
          linkedVariantTitle: "6 inch",
          linkedImageUrl: "https://cdn.shopify.com/listing-thai.jpg",
          photoUrls: [],
        })),
      },
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.match(html, /Grower&#x27;s Choice/);
    assert.match(html, /Monstera Thai Constellation/);
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
  it("does not offer Close Request before the customer submits a response", () => {
    const reviewing = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });
    assert.ok(!reviewing.includes('value="close-request"'));
    assert.match(reviewing, /value="submit-response"/);
  });

  it("does not offer Close Request on an unanswered all-unavailable offer", () => {
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
      formAction: "/apps/plant-requests/requests/req-1",
    });
    assert.ok(!html.includes('value="close-request"'));
    assert.match(html, /value="submit-response"/);
  });

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

    assert.match(html, /No checkout link was created/);
    assert.match(html, /value="close-request"/);
    assert.ok(
      !html.includes("Back to My Requests"),
      "Close Request replaces the bottom Back link after decline-all",
    );
  });

  it("stops offering to close a request that is already closed", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "reject" }]),
      fedexRemovalWarning: "",
      requestClosed: true,
      formAction: "/apps/plant-requests/requests/req-1",
      backHref: "/apps/plant-requests",
    });

    assert.ok(!html.includes('value="close-request"'));
    assert.match(html, /Back to My Requests/);
  });

  it("does not offer Close Request when the customer accepted a plant", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: "https://upt.myshopify.com/invoice/abc",
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });
    assert.ok(!html.includes('value="close-request"'));
  });
});

describe("a customer who declined everything can still see what they declined", () => {
  const declined = (requestClosed: boolean) =>
    render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([
        { plantName: "Monstera Albo", choice: "reject" },
        { plantName: "Hoya Callistophylla", choice: "reject" },
      ]),
      fedexRemovalWarning: "",
      requestClosed,
      statusLabel: requestClosed ? "Closed" : "No Payment Needed",
      formAction: "/apps/plant-requests/requests/req-1",
    });

  it("shows the plant, the price it was offered at, the notes and every photo", () => {
    const html = declined(false);

    assert.match(html, /Plants you declined/);
    assert.match(html, /Monstera Albo/);
    assert.match(html, /Hoya Callistophylla/);
    assert.match(html, /\$250\.00/);
    assert.match(html, /One older leaf has a small scar/);
    assert.match(html, /Declined/);
    for (const url of PHOTOS) {
      assert.ok(html.includes(url), `${url} is missing from the declined item`);
    }
  });

  it("keeps that history after the request is closed", () => {
    const html = declined(true);

    assert.match(html, /Plants you declined/);
    assert.match(html, /Monstera Albo/);
    for (const url of PHOTOS) {
      assert.ok(html.includes(url));
    }
    assert.ok(!html.includes('value="close-request"'), "there is nothing left to do");
  });

  it("offers no payment and never claims the FedEx upgrade was applied", () => {
    for (const html of [declined(false), declined(true)]) {
      assert.ok(!html.includes("Continue to Checkout"));
      assert.ok(!html.includes("Complete your payment"));
      assert.ok(!html.includes("Final approval summary"));
      assert.ok(
        !/FedEx Priority Overnight Upgrade —/.test(html),
        "nothing shipped, so the upgrade was neither kept nor charged",
      );
      assert.match(html, /FedEx Priority Overnight upgrade was not applied/);
    }
  });
});

describe("the customer-facing status label", () => {
  it("is on the request detail page, not only the list", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      statusLabel: "Offer Ready for Review",
      statusTone: "caution",
    });

    assert.match(html, /<s-badge tone="caution">Offer Ready for Review<\/s-badge>/);
  });

  it("renders nothing when there is no label to show", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
    });

    assert.ok(!html.includes("Offer Ready for Review"));
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
    // An expired unpaid request releases its plants and voids the invoice, so
    // promising they are reserved — or offering the old checkout link — is a
    // promise this page cannot keep.
    assert.match(lapsed, /Offer Expired/);
    assert.match(lapsed, /no longer being held/);
    assert.match(lapsed, /no longer valid/);
    assert.match(lapsed, /submit a new request/);
    assert.ok(!lapsed.includes("still held for you"));
    assert.ok(!lapsed.includes("emailed this link to you just in case"));
  });

  it("does not offer the stale invoice once the hold has ended", () => {
    assert.ok(!lapsed.includes("Continue to Checkout"));
    assert.ok(!lapsed.includes("https://upt.myshopify.com/invoice/abc"));
  });

  it("does not claim the plants are still held when the checkout URL is already gone", () => {
    // Production drops the invoice URL via payableInvoiceUrl once the hold
    // ends. The "could not create your payment link" banner must not appear
    // in that state — it would contradict Offer Expired.
    const gone = render({
      offer: offer({ expiresAt: yesterday() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: null,
      fedexRemovalWarning: "",
      requestClosed: false,
    });
    assert.match(gone, /Offer Expired/);
    assert.ok(!gone.includes("still held for you"));
    assert.ok(!gone.includes("could not create your payment link"));
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

describe("a request the customer already closed", () => {
  const closed = render({
    offer: offer({ expiresAt: inThreeDays() }),
    response: null,
    fedexRemovalWarning: "",
    requestClosed: true,
  });

  it("stops presenting the offer as live", () => {
    // Closing an all-unavailable request used to hand back the countdown and
    // the same Close Request button, while the portal list already said Closed.
    assert.match(closed, /Request closed/);
    assert.match(closed, /nothing left to answer or pay/);
    assert.ok(!closed.includes("being held for you"));
    assert.ok(!closed.includes("remaining"));
  });

  it("offers no way to answer or close it again", () => {
    assert.equal([...closed.matchAll(/type="radio"/g)].length, 0);
    assert.ok(!closed.includes("Close Request"));
  });
});

describe("the FedEx removal warning", () => {
  it("is checked by default and carries the Settings warning in a labelled dialog", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "Carrier delays are not covered.",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(html, /id="fedex-upgrade"/);
    assert.match(html, /name="fedexUpgradeSelected"/);
    assert.match(html, /Carrier delays are not covered/);
    assert.match(html, /id="fedex-removal-dialog"/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /Keep FedEx Upgrade/);
    assert.match(html, /I Understand, Remove Upgrade/);
    assert.match(html, /name="fedexRemovalAcknowledged"/);
  });

  it("shows the same Settings text on the no-JS confirmation step", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "Carrier delays are not covered.",
      requestClosed: false,
      pendingFedexRemoval: true,
      submittedChoices: { "item-1": "accept" },
      fedexSelected: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(html, /Carrier delays are not covered/);
    assert.match(html, /I Understand, Remove Upgrade/);
    assert.match(html, /Keep FedEx Upgrade/);
    assert.match(html, /value="keep-fedex"/);
  });
});

describe("the customer support note", () => {
  const wording = [
    "Need help with this request or need something changed",
    CUSTOMER_SUPPORT_EMAIL,
    "follow your request status here",
  ];

  it("shows on an unanswered live offer and points the customer back to the portal", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      requestStatus: "Pending",
      statusLabel: "Offer Ready for Review",
    });

    for (const phrase of wording) {
      assert.ok(html.includes(phrase), `missing: ${phrase}`);
    }
    assert.match(html, new RegExp(`mailto:${CUSTOMER_SUPPORT_EMAIL}`));
    assert.ok(!html.includes("Contact us for updates"));
    assert.ok(!html.includes("questions about the status"));
    assert.ok(!html.includes("Open Draft Order in Shopify"));
    assert.ok(!html.includes("admin.shopify.com/store"));
  });

  it("shows while payment is still outstanding", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      invoiceUrl: "https://upt.myshopify.com/invoice/abc",
      fedexRemovalWarning: "",
      requestClosed: false,
      requestStatus: "Pending",
      statusLabel: "Needs Payment",
    });

    assert.ok(html.includes(CUSTOMER_SUPPORT_EMAIL));
    assert.ok(html.includes("follow your request status here"));
  });

  it("is hidden on a historical Closed request", () => {
    const html = render({
      offer: offer({ expiresAt: inThreeDays() }),
      response: answer([{ plantName: "Monstera Albo", choice: "reject" }]),
      fedexRemovalWarning: "",
      requestClosed: true,
      requestStatus: "Closed",
      statusLabel: "Closed",
    });

    assert.ok(!html.includes(CUSTOMER_SUPPORT_EMAIL));
    assert.ok(!html.includes("Need help with this request"));
    assert.ok(!html.includes("Open Draft Order in Shopify"));
  });

  it("is hidden after the hold ends", () => {
    const html = render({
      offer: offer({ expiresAt: yesterday() }),
      response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
      fedexRemovalWarning: "",
      requestClosed: false,
      requestStatus: "Expired",
    });

    assert.ok(!html.includes(CUSTOMER_SUPPORT_EMAIL));
    assert.ok(!html.includes("Need help with this request"));
  });
});
