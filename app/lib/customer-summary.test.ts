import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerOfferView } from "../components/customer-offer-view";
import {
  canAdminCloseDeclinedRequest,
  fedExSummaryState,
  heatPackSummaryState,
  type CustomerOfferResponse,
  type SampleCustomerOffer,
} from "./portal";

function offer(): SampleCustomerOffer {
  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: 3,
    expiresAt: "Sep 10, 2026, 3:00 PM PDT",
    expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
    urgencyMessage: "Offer expires soon",
    holdMessage: "Held until Sep 10",
    fedexUpgradeLabel: "FedEx Priority Overnight Upgrade",
    fedexUpgradePrice: 15,
    heatPackAddonEnabled: true,
    heatPackLabel: "Heat Pack (includes foil insulation)",
    heatPackDescription: "Weather review before shipment.",
    heatPackPrice: 7,
    heatPackPriceResolved: true,
    customerEmail: "alex@example.com",
    customerName: "Alex Rivera",
    requestNumber: "REQ1",
    items: [
      {
        id: "offer-item-1",
        sourceItemId: "item-1",
        plantName: "Monstera",
        availability: "available",
        fulfillmentType: "exact_plant",
        price: 250,
        notesFromUpt: "Notes",
        photoUrl: "",
        photoUrls: [],
        quantity: 1,
      },
    ],
  };
}

function response(
  overrides: Partial<CustomerOfferResponse> = {},
): CustomerOfferResponse {
  return {
    requestId: "req-1",
    requestNumber: "REQ1",
    customerName: "Alex Rivera",
    customerEmail: "alex@example.com",
    respondedAt: "Aug 20, 2026, 9:00 AM PDT",
    respondedAtIso: new Date().toISOString(),
    fedexUpgradeSelected: true,
    fedexUpgradePrice: 15,
    heatPackSelected: true,
    heatPackPrice: 7,
    hasAcceptedPurchasableItems: true,
    items: [
      {
        offerItemId: "response-1",
        sourceItemId: "item-1",
        plantName: "Monstera",
        choice: "accept",
        price: 250,
        quantity: 1,
        lineRevenue: 250,
        customerNotes: "Notes",
        photoUrls: [],
        fulfillmentType: "exact_plant",
      },
    ],
    ...overrides,
  };
}

describe("customer addon summary state", () => {
  it("marks FedEx added only when plants were accepted and FedEx stayed on", () => {
    assert.equal(
      fedExSummaryState({
        hasAcceptedPurchasableItems: true,
        fedexUpgradeSelected: true,
      }),
      "added",
    );
    assert.equal(
      fedExSummaryState({
        hasAcceptedPurchasableItems: true,
        fedexUpgradeSelected: false,
        fedexExplicitlyDeclined: true,
      }),
      "declined",
    );
    assert.equal(
      fedExSummaryState({
        hasAcceptedPurchasableItems: false,
        fedexUpgradeSelected: false,
      }),
      "not_applicable",
    );
    assert.equal(
      fedExSummaryState({
        hasAcceptedPurchasableItems: false,
        fedexUpgradeSelected: false,
        fedexExplicitlyDeclined: true,
      }),
      "declined",
    );
  });

  it("marks Heat Pack from the response snapshot only", () => {
    assert.equal(
      heatPackSummaryState({
        hasAcceptedPurchasableItems: true,
        heatPackSelected: true,
      }),
      "added",
    );
    assert.equal(
      heatPackSummaryState({
        hasAcceptedPurchasableItems: true,
        heatPackSelected: false,
      }),
      "not_added",
    );
    assert.equal(
      heatPackSummaryState({
        hasAcceptedPurchasableItems: false,
        heatPackSelected: false,
      }),
      "not_offered",
    );
    assert.equal(
      heatPackSummaryState({
        hasAcceptedPurchasableItems: true,
        heatPackSelected: null,
      }),
      "not_offered",
    );
  });
});

describe("customer final approval addon cards", () => {
  function renderSummary(
    overrides: Partial<CustomerOfferResponse> = {},
    options: { fedexRemovalWarning?: string } = {},
  ) {
    return renderToStaticMarkup(
      createElement(CustomerOfferView, {
        offer: offer(),
        response: response(overrides),
        fedexRemovalWarning: options.fedexRemovalWarning ?? "",
        requestClosed: false,
        formAction: "/apps/plant-requests/requests/req-1",
      }),
    );
  }

  it("renders mint FedEx and Heat Pack cards when both were added", () => {
    const html = renderSummary();
    assert.match(html, /upt-addon-summary-positive/);
    assert.match(html, /FedEx Priority Overnight Upgrade/);
    assert.match(html, />Added</);
    assert.match(html, /Heat Pack \(includes foil insulation\)/);
    assert.match(html, />\$15\.00/);
    assert.match(html, />\$7\.00/);
  });

  it("renders red FedEx card with the removal warning when explicitly declined", () => {
    const html = renderSummary(
      {
        fedexUpgradeSelected: false,
        fedexExplicitlyDeclined: true,
        hasAcceptedPurchasableItems: true,
      },
      { fedexRemovalWarning: "Carrier delays are not covered." },
    );
    assert.match(html, /upt-addon-summary-negative/);
    assert.match(html, />Declined</);
    assert.match(html, /Carrier delays are not covered\./);
    assert.doesNotMatch(html, /FedEx Priority Overnight Upgrade — removed/);
  });

  it("renders explicit FedEx decline even when no plants were accepted", () => {
    const html = renderSummary(
      {
      hasAcceptedPurchasableItems: false,
      fedexUpgradeSelected: false,
      fedexExplicitlyDeclined: true,
      heatPackSelected: null,
      items: [
        {
          offerItemId: "response-1",
          sourceItemId: "item-1",
          plantName: "Monstera",
          choice: "reject",
          price: 250,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "Notes",
          photoUrls: [],
          fulfillmentType: "exact_plant",
        },
      ],
      },
      { fedexRemovalWarning: "Carrier delays are not covered." },
    );
    assert.match(html, /class="upt-addon-summary-card upt-addon-summary-negative/);
    assert.match(html, /FedEx Priority Overnight Upgrade/);
    assert.match(html, />Declined</);
    assert.match(html, /Carrier delays are not covered\./);
    assert.doesNotMatch(html, /Heat Pack \(includes foil insulation\)/);
  });

  it("omits FedEx when auto-disabled with no explicit customer decision", () => {
    const html = renderSummary({
      hasAcceptedPurchasableItems: false,
      fedexUpgradeSelected: false,
      fedexExplicitlyDeclined: false,
      heatPackSelected: null,
      items: [
        {
          offerItemId: "response-1",
          sourceItemId: "item-1",
          plantName: "Monstera",
          choice: "reject",
          price: 250,
          quantity: 1,
          lineRevenue: 0,
          customerNotes: "Notes",
          photoUrls: [],
          fulfillmentType: "exact_plant",
        },
      ],
    });
    assert.doesNotMatch(html, /class="upt-addon-summary-card/);
    assert.doesNotMatch(html, /FedEx Priority Overnight Upgrade/);
    assert.doesNotMatch(html, /Heat Pack \(includes foil insulation\)/);
  });

  it("renders a red Heat Pack card when the customer chose No Heat Pack", () => {
    const html = renderSummary({
      heatPackSelected: false,
    });
    assert.match(html, /upt-addon-summary-negative/);
    assert.match(html, />Not Added</);
  });

  it("does not label Heat Pack Not Added when it was not offered", () => {
    const html = renderSummary({
      heatPackSelected: null,
    });
    assert.doesNotMatch(html, />Not Added</);
    assert.doesNotMatch(html, /Heat Pack \(includes foil insulation\)/);
  });
});

describe("admin close declined request visibility", () => {
  it("allows close only for pending decline-all responses", () => {
    assert.equal(
      canAdminCloseDeclinedRequest({
        status: "Pending",
        hasCustomerResponse: true,
        hasAcceptedPurchasableItems: false,
      }),
      true,
    );
    assert.equal(
      canAdminCloseDeclinedRequest({
        status: "Closed",
        hasCustomerResponse: true,
        hasAcceptedPurchasableItems: false,
      }),
      false,
    );
    assert.equal(
      canAdminCloseDeclinedRequest({
        status: "Expired",
        hasCustomerResponse: true,
        hasAcceptedPurchasableItems: false,
      }),
      false,
    );
    assert.equal(
      canAdminCloseDeclinedRequest({
        status: "Pending",
        hasCustomerResponse: true,
        hasAcceptedPurchasableItems: true,
      }),
      false,
    );
  });

  it("wires the shared rule into web admin and iOS admin detail", () => {
    const web = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const ios = readFileSync(
      path.join(import.meta.dirname, "..", "..", "mobile", "ios-admin", "src", "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    const mobile = readFileSync(
      path.join(import.meta.dirname, "admin-mobile-actions.server.ts"),
      "utf8",
    );
    assert.match(web, /canAdminCloseDeclinedRequest/);
    assert.match(mobile, /canAdminCloseDeclinedRequest/);
    assert.match(ios, /canCloseDeclined/);
  });
});
