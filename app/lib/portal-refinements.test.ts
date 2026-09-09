import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerOfferView } from "../components/customer-offer-view";
import {
  heatPackChoiceMissing,
  heatPackUiState,
} from "./customer-portal";
import {
  formatAdminNoteTimestamp,
  formatCustomerDateTime,
  formatViewerDateTime,
  PORTAL_DISPLAY_TIME_ZONE,
} from "./customer-time";
import {
  DEFAULT_HEAT_PACK_DESCRIPTION,
  effectiveHeatPackDescription,
  partitionPendingOfferItems,
  partitionPlantItemsByCustomerChoice,
  shouldGroupPendingOfferItems,
  shouldGroupTerminalPlantItems,
  buildDraftOrderLineItems,
  type CustomerOfferResponse,
  type OfferPlantItem,
  type SampleCustomerOffer,
} from "./portal";

const PHOTOS = ["https://cdn.shopify.com/photo.jpg"];

function plant(overrides: Partial<OfferPlantItem> = {}): OfferPlantItem {
  return {
    id: "offer-req-1",
    sourceItemId: "item-1",
    plantName: "Monstera Albo",
    price: 250,
    photoUrl: PHOTOS[0],
    photoUrls: PHOTOS,
    notesFromUpt: "Notes",
    quantity: 1,
    availability: "available",
    fulfillmentType: "exact_plant",
    ...overrides,
  };
}

function offer(overrides: Partial<SampleCustomerOffer> = {}): SampleCustomerOffer {
  const expiresAtIso =
    overrides.expiresAtIso ??
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const expiresAt =
    overrides.expiresAt ??
    formatCustomerDateTime(new Date(expiresAtIso));
  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: 3,
    expiresAt,
    expiresAtIso,
    urgencyMessage: "Offer expires soon",
    holdMessage: "Held until Sep 8",
    fedexUpgradeLabel: "FedEx Priority Overnight Upgrade",
    fedexUpgradePrice: 15,
    heatPackAddonEnabled: true,
    heatPackLabel: "Heat Pack (includes foil insulation)",
    heatPackDescription:
      "We review the weather for every order before shipment. If a heat pack is not necessary, the cost will be refunded. If one is required but was not added, your order will be placed on hold and we will contact you.",
    heatPackPrice: 7,
    heatPackPriceResolved: true,
    customerEmail: "alex.rivera@example.com",
    customerName: "Alex Rivera",
    requestNumber: "REQ1",
    items: [plant()],
    ...overrides,
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
    respondedAt: expiresAtLabel(),
    respondedAtIso: new Date().toISOString(),
    fedexUpgradeSelected: true,
    fedexUpgradePrice: 15,
    heatPackSelected: false,
    heatPackPrice: 0,
    hasAcceptedPurchasableItems: choices.some((entry) => entry.choice === "accept"),
    items: choices.map((entry, index) => ({
      offerItemId: `response-item-${index}`,
      sourceItemId: `item-${index + 1}`,
      plantName: entry.plantName,
      choice: entry.choice,
      price: 250,
      quantity: 1,
      lineRevenue: entry.choice === "accept" ? 250 : 0,
      customerNotes: "Notes",
      photoUrls: PHOTOS,
      fulfillmentType: "exact_plant" as const,
    })),
  };
}

function expiresAtLabel() {
  return formatCustomerDateTime(new Date("2026-09-08T22:24:00.000Z"));
}

function render(props: Parameters<typeof CustomerOfferView>[0]): string {
  return renderToStaticMarkup(createElement(CustomerOfferView, props));
}

describe("heat pack price display", () => {
  it("shows the resolved Shopify price on the live offer form", () => {
    const html = render({
      offer: offer({ heatPackPrice: 7, heatPackPriceResolved: true }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.match(html, /\$7\.00/);
    assert.match(html, /Heat Pack \(includes foil insulation\)/);
    assert.match(html, /Add Heat Pack/);
    assert.match(html, /No Heat Pack/);
    assert.match(html, /upt-heat-pack-choice/);
  });

  it("does not show a $0 fallback when the variant is unresolved", () => {
    const html = render({
      offer: offer({
        heatPackPrice: null,
        heatPackPriceResolved: false,
      }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });

    assert.ok(!html.includes("$0.00"), "unresolved heat pack must not quote zero");
    assert.ok(!html.includes("data-heat-pack-section"));
  });

  it("uses the same variant on draft-order heat pack lines", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [
        {
          itemId: "item-1",
          plantName: "Monstera",
          price: 250,
          quantity: 1,
          weightLbs: 2,
        },
      ],
      fedexSelected: false,
      fedexLabel: "FedEx",
      fedexPrice: 15,
      heatPackSelected: true,
      heatPackLabel: "Heat Pack (includes foil insulation)",
      heatPackPrice: 7,
      heatPackVariantGid: "gid://shopify/ProductVariant/heat",
    });

    const heatLine = lines.find((line) => line.kind === "heat_pack");
    assert.ok(heatLine);
    assert.equal(heatLine?.price, 7);
    assert.equal(heatLine?.variantId, "gid://shopify/ProductVariant/heat");
  });
});

describe("heat pack disabled state", () => {
  it("requires an explicit choice only when plants are accepted", () => {
    assert.equal(
      heatPackChoiceMissing({
        heatPackAddonEnabled: true,
        acceptedPurchasableCount: 0,
        heatPackChoice: null,
      }),
      false,
    );
    assert.equal(
      heatPackChoiceMissing({
        heatPackAddonEnabled: true,
        acceptedPurchasableCount: 1,
        heatPackChoice: null,
      }),
      true,
    );
  });

  it("keeps the section visible but disabled with zero accepted plants", () => {
    assert.deepEqual(
      heatPackUiState({
        heatPackAddonEnabled: true,
        acceptedPurchasableCount: 0,
        heatPackChoice: true,
        heatPackPriceResolved: true,
      }),
      { visible: true, enabled: false, selected: null },
    );
    assert.deepEqual(
      heatPackUiState({
        heatPackAddonEnabled: true,
        acceptedPurchasableCount: 2,
        heatPackChoice: null,
        heatPackPriceResolved: true,
      }),
      { visible: true, enabled: true, selected: null },
    );
  });

  it("greys out heat pack choices in the enhance script instead of hiding the section", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-enhance.tsx"),
      "utf8",
    );
    assert.match(source, /setChrome\(acceptedCount\(\) > 0\)/);
    assert.match(source, /section\.style\.opacity/);
    assert.doesNotMatch(source, /section\.hidden = !enabled/);
  });
});

describe("checkout prominence and support note placement", () => {
  const checkoutHtml = render({
    offer: offer({ expiresAtIso: new Date(Date.now() + 86400000).toISOString() }),
    response: answer([{ plantName: "Monstera Albo", choice: "accept" }]),
    invoiceUrl: "https://upt.myshopify.com/invoice/abc",
    fedexRemovalWarning: "",
    requestClosed: false,
    requestStatus: "Pending",
  });

  it("shows a prominent Complete Your Purchase checkout panel", () => {
    assert.match(checkoutHtml, /Complete Your Purchase/);
    assert.match(checkoutHtml, /upt-checkout-panel/);
    assert.match(checkoutHtml, /Continue to Checkout/);
    assert.match(checkoutHtml, /https:\/\/upt\.myshopify\.com\/invoice\/abc/);
  });

  it("places the support note after the checkout panel", () => {
    const checkoutIndex = checkoutHtml.indexOf("Complete Your Purchase");
    const supportIndex = checkoutHtml.indexOf("Need help with this request");
    assert.ok(checkoutIndex >= 0);
    assert.ok(supportIndex > checkoutIndex);
  });
});

describe("Heat Pack description setting", () => {
  it("falls back to the default copy when blank", () => {
    assert.equal(effectiveHeatPackDescription(""), DEFAULT_HEAT_PACK_DESCRIPTION);
    assert.equal(effectiveHeatPackDescription("   "), DEFAULT_HEAT_PACK_DESCRIPTION);
    assert.equal(
      effectiveHeatPackDescription("Custom heat pack note."),
      "Custom heat pack note.",
    );
  });

  it("exposes editable Heat Pack description on web and iOS settings", () => {
    const web = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    const ios = readFileSync(
      path.join(import.meta.dirname, "..", "..", "mobile", "ios-admin", "src", "screens", "SettingsScreen.tsx"),
      "utf8",
    );
    assert.match(web, /heatPackDescription/);
    assert.match(ios, /heatPackDescription/);
  });

  it("shows the saved Heat Pack description on the customer offer", () => {
    const html = render({
      offer: offer({
        heatPackDescription: "Ship with care when it is cold.",
      }),
      response: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      formAction: "/apps/plant-requests/requests/req-1",
    });
    assert.match(html, /Ship with care when it is cold\./);
  });
});

describe("pending offer grouping before customer response", () => {
  it("groups unanswered pending offers into OFFERED then NOT AVAILABLE", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Pending", true, undefined),
      true,
    );
    assert.equal(
      shouldGroupPendingOfferItems("Pending", true, [
        { sourceItemId: "a", choice: "accept" },
      ]),
      false,
    );
    const grouped = partitionPendingOfferItems([
      { id: "a", availability: "available" },
      { id: "b", availability: "not_available" },
    ]);
    assert.deepEqual(
      grouped.offered.map((item) => item.id),
      ["a"],
    );
    assert.deepEqual(
      grouped.notAvailable.map((item) => item.id),
      ["b"],
    );
  });

  it("groups expired unanswered offers into OFFERED then NOT AVAILABLE", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Expired", true, undefined),
      true,
    );
    assert.equal(
      shouldGroupPendingOfferItems("Expired", true, [
        { sourceItemId: "a", choice: "reject" },
      ]),
      false,
    );
    const grouped = partitionPendingOfferItems([
      { id: "offered", availability: "available" },
      { id: "na", availability: "not_available" },
    ]);
    assert.deepEqual(grouped.offered.map((item) => item.id), ["offered"]);
    assert.deepEqual(grouped.notAvailable.map((item) => item.id), ["na"]);
  });

  it("groups closed unanswered all-unavailable requests into NOT AVAILABLE only", () => {
    assert.equal(shouldGroupPendingOfferItems("Closed", false, null), true);
    const grouped = partitionPendingOfferItems([
      { id: "x", availability: "not_available" },
      { id: "y", availability: "not_available" },
    ]);
    assert.deepEqual(grouped.offered, []);
    assert.deepEqual(
      grouped.notAvailable.map((item) => item.id),
      ["x", "y"],
    );
  });

  it("groups closed unanswered mixed snapshot into OFFERED then NOT AVAILABLE", () => {
    assert.equal(shouldGroupPendingOfferItems("Closed", true, undefined), true);
    const grouped = partitionPendingOfferItems([
      { id: "was-offered", availability: "available" },
      { id: "was-na", availability: "not_available" },
    ]);
    assert.deepEqual(grouped.offered.map((item) => item.id), ["was-offered"]);
    assert.deepEqual(grouped.notAvailable.map((item) => item.id), ["was-na"]);
  });

  it("keeps answered closed/expired requests on ACCEPTED / DECLINED / NOT AVAILABLE", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Closed", true, [
        { sourceItemId: "a", choice: "accept" },
      ]),
      false,
    );
    assert.equal(
      shouldGroupPendingOfferItems("Expired", true, [
        { sourceItemId: "b", choice: "reject" },
      ]),
      false,
    );
    assert.equal(shouldGroupTerminalPlantItems("Closed", [
      { sourceItemId: "a", choice: "accept" },
    ]), true);
  });

  it("does not label unanswered offered items Accepted or Declined", () => {
    const grouped = partitionPendingOfferItems([
      { id: "a", availability: "available" },
    ]);
    assert.deepEqual(Object.keys(grouped), ["offered", "notAvailable"]);
    assert.doesNotMatch(JSON.stringify(grouped), /accept|declin/i);
  });

  it("renders OFFERED before NOT AVAILABLE on the admin request page", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(source, /PendingOfferItemsSection/);
    assert.match(source, /shouldGroupPendingOfferItems/);
    assert.ok(source.indexOf("OFFERED") < source.indexOf("NOT AVAILABLE"));
  });
});

describe("terminal plant grouping with NOT AVAILABLE", () => {
  const items = [
    { id: "a", plantName: "Monstera", availability: "available" as const },
    { id: "b", plantName: "Philodendron", availability: "available" as const },
    { id: "c", plantName: "Hoya", availability: "not_available" as const },
  ];

  it("orders accepted, declined, then not available and omits empty sections", () => {
    const grouped = partitionPlantItemsByCustomerChoice(items, [
      { sourceItemId: "a", choice: "accept" },
      { sourceItemId: "b", choice: "reject" },
      { sourceItemId: "c", choice: "unavailable" },
    ]);
    assert.deepEqual(
      grouped.accepted.map((item) => item.id),
      ["a"],
    );
    assert.deepEqual(
      grouped.declined.map((item) => item.id),
      ["b"],
    );
    assert.deepEqual(
      grouped.notAvailable.map((item) => item.id),
      ["c"],
    );
  });

  it("renders NOT AVAILABLE on the admin request page", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(source, /NOT AVAILABLE/);
    assert.match(source, /notAvailable\.length > 0/);
    assert.match(source, /upt-terminal-group-heading/);
  });
});

describe("Pacific Time display", () => {
  const winter = new Date("2026-01-15T18:00:00.000Z");
  const summer = new Date("2026-07-08T18:00:00.000Z");

  it("always formats customer-facing timestamps in America/Los_Angeles", () => {
    assert.equal(PORTAL_DISPLAY_TIME_ZONE, "America/Los_Angeles");
    const pacificWinter = formatCustomerDateTime(winter);
    const pacificSummer = formatCustomerDateTime(summer);
    assert.match(pacificWinter, /10:00 AM/);
    assert.match(pacificWinter, /PST/);
    assert.match(pacificSummer, /11:00 AM/);
    assert.match(pacificSummer, /PDT/);
    assert.equal(winter.toISOString(), "2026-01-15T18:00:00.000Z");
  });

  it("formats admin note stamps in Pacific Time regardless of a passed zone", () => {
    const stamp = formatAdminNoteTimestamp("2026-09-08T22:24:00.000Z", "America/New_York");
    assert.match(stamp, /Sep 8, 2026/);
    assert.match(stamp, /3:24 PM/);
    assert.match(stamp, /PDT/);
  });

  it("formats viewer timestamps in Pacific Time", () => {
    const label = formatViewerDateTime("2026-08-24T19:00:00.000Z", "America/New_York");
    assert.match(label, /12:00 PM/);
    assert.match(label, /PDT/);
  });
});

describe("customer form helper and note styling", () => {
  it("italicizes the PLANTS REQUESTED helper line", () => {
    const theme = readFileSync(
      path.join(import.meta.dirname, "..", "components", "theme.tsx"),
      "utf8",
    );
    assert.match(theme, /\.upt-card-helper[\s\S]*font-style: italic/);
  });

  it("softens internal note timestamps on web and iOS", () => {
    const web = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const iosUi = readFileSync(
      path.join(import.meta.dirname, "..", "..", "mobile", "ios-admin", "src", "ui.ts"),
      "utf8",
    );
    assert.match(web, /upt-admin-note-time/);
    assert.match(iosUi, /noteTimestamp/);
  });
});
