import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  mobileAdminDashboardPayload,
  mobileAdminExactPlantsPayload,
  toMobileAdminRequestDetail,
  toMobileExactPlantRow,
} from "./admin-mobile-api";
import type { ExactPlantCandidateRow } from "./exact-plants.server";
import type { PlantRequest } from "./portal";

function request(overrides: Partial<PlantRequest> = {}): PlantRequest {
  return {
    id: "req-1",
    requestNumber: "REQ12",
    customer: "Alex Rivera",
    email: "alex.rivera@example.com",
    status: "Pending",
    submittedDate: "Aug 20, 2026",
    submittedAtIso: "2026-08-20T16:00:00.000Z",
    hasResponded: false,
    items: [
      {
        id: "item-1",
        plantName: "Monstera Albo",
        offeredName: "Monstera Albo",
        quantity: 1,
        itemStatus: "Offered",
        availability: "available",
        unavailableReason: "not in our current inventory",
        fulfillmentType: "exact_plant",
        price: 250,
        weightLbs: 8,
        customerRequestNotes: "Climbing, please",
        adminNotes: "internal only",
        customerFacingNotes: "One older leaf has a small scar.",
        photoPreviewUrl: "",
        photoUrls: ["https://cdn.shopify.com/albo.jpg"],
        photos: [],
      },
    ],
    ...overrides,
  };
}

describe("iOS admin API payloads", () => {
  it("lists the same dashboard rows the web admin filters", () => {
    const payload = mobileAdminDashboardPayload(
      "demo-shop.myshopify.com",
      [request(), request({ id: "req-2", status: "New", requestNumber: "REQ13" })],
      "",
      "Pending",
    );
    assert.equal(payload.shop, "demo-shop.myshopify.com");
    assert.equal(payload.stats.newRequests, 1);
    assert.equal(payload.stats.pending, 1);
    assert.equal(payload.requests.length, 1);
    assert.equal(payload.requests[0].requestNumber, "REQ12");
    assert.equal(payload.requests[0].plantsRequested, "Monstera Albo");
    assert.equal(payload.requests[0].hasExistingOrder, false);
  });

  it("filters New existing-order rows the same way the website does", () => {
    const payload = mobileAdminDashboardPayload(
      "demo-shop.myshopify.com",
      [
        request({
          id: "req-existing",
          status: "New",
          requestNumber: "REQ23",
          hasExistingOrder: true,
        }),
        request({
          id: "req-new",
          status: "New",
          requestNumber: "REQ24",
          hasExistingOrder: false,
        }),
        request({
          id: "req-closed-existing",
          status: "Closed",
          requestNumber: "REQ6",
          hasExistingOrder: true,
        }),
      ],
      "",
      "ExistingOrder",
    );
    assert.equal(payload.statusFilter, "ExistingOrder");
    assert.equal(payload.requests.length, 1);
    assert.equal(payload.requests[0].requestNumber, "REQ23");
    assert.equal(payload.requests[0].hasExistingOrder, true);
  });

  it("keeps admin notes and photos on the detail payload", () => {
    const detail = toMobileAdminRequestDetail(request());
    assert.equal(detail.requestNumber, "REQ12");
    assert.equal(detail.items[0].customerRequestNotes, "Climbing, please");
    assert.equal(detail.items[0].adminNotes, "internal only");
    assert.deepEqual(detail.items[0].photoUrls, ["https://cdn.shopify.com/albo.jpg"]);
    assert.deepEqual(detail.items[0].photos, []);
    assert.equal(detail.items[0].unavailableReason, undefined);
    assert.equal(detail.canEditItems, false);
    assert.equal(detail.canSendOffer, false);
    assert.equal(detail.canOverrideClose, true);
    assert.equal(detail.hasExistingOrder, false);
  });

  it("carries Existing Order and a frozen ADD ON onto the phone detail", () => {
    const detail = toMobileAdminRequestDetail(
      request({
        hasExistingOrder: true,
        sentOffer: {
          expirationDays: 3,
          sentAt: "Aug 21, 2026",
          sentAtIso: "2026-08-21T16:00:00.000Z",
          expiresAt: "Aug 24, 2026",
          expiresAtIso: "2026-08-24T16:00:00.000Z",
          offerLink: "https://example.test/customer/requests/req-1",
          shippingFeeOverride: 12.5,
        },
      }),
    );
    assert.equal(detail.hasExistingOrder, true);
    assert.equal(detail.sentOffer?.shippingFeeOverride, 12.5);
  });

  it("does not copy a customer note into the admin note on the phone", () => {
    const detail = toMobileAdminRequestDetail(
      request({
        items: [
          {
            ...request().items[0],
            customerRequestNotes: "Climbing, please",
            adminNotes: "Climbing, please",
          },
        ],
      }),
    );
    assert.equal(detail.items[0].customerRequestNotes, "Climbing, please");
    assert.equal(detail.items[0].adminNotes, "");
  });

  it("lets a complete New request be sent from the phone", () => {
    const detail = toMobileAdminRequestDetail(
      request({
        status: "New",
        items: [
          {
            ...request().items[0],
            itemStatus: "Requested",
            photos: [{ id: "p1", url: "https://cdn.shopify.com/albo.jpg" }],
          },
        ],
      }),
    );
    assert.equal(detail.canEditItems, true);
    assert.equal(detail.canSendOffer, true);
    assert.deepEqual(detail.offerProblems, []);
  });

  it("includes the unavailable reason on a Not Available line", () => {
    const detail = toMobileAdminRequestDetail(
      request({
        items: [
          {
            ...request().items[0],
            availability: "not_available",
            unavailableReason: "currently not in UPT prop circulation",
          },
        ],
      }),
    );
    assert.equal(
      detail.items[0].unavailableReason,
      "currently not in UPT prop circulation",
    );
  });

  it("filters the EXACT PLANTS queue the same way the website does", () => {
    const eligible: ExactPlantCandidateRow = {
      requestItemId: "item-1",
      requestId: "req-1",
      requestNumber: "REQ8",
      releaseReason: "customer_declined",
      eligibleAt: "2026-08-20T16:00:00.000Z",
      title: "Thai Constellation",
      price: 175,
      weightLbs: 9.5,
      photoUrls: ["https://cdn.shopify.com/thai.jpg"],
      listing: null,
    };
    const listed: ExactPlantCandidateRow = {
      ...eligible,
      requestItemId: "item-2",
      listing: {
        status: "listed",
        shopifyProductGid: "gid://shopify/Product/1",
        productAdminUrl: "https://admin.shopify.com/store/demo/products/1",
      },
    };
    const dismissed: ExactPlantCandidateRow = {
      ...eligible,
      requestItemId: "item-3",
      dismissedAt: "2026-08-21T16:00:00.000Z",
    };

    const queue = mobileAdminExactPlantsPayload([eligible, listed], [dismissed], "not_yet_listed");
    assert.equal(queue.listingFilter, "not_yet_listed");
    assert.equal(queue.counts.all, 2);
    assert.equal(queue.counts.not_yet_listed, 1);
    assert.equal(queue.counts.listed, 1);
    assert.equal(queue.counts.dismissed, 1);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].title, "Thai Constellation");
    assert.equal(queue.items[0].canDismiss, true);
    assert.equal(queue.items[0].canList, true);
    assert.equal(queue.items[0].releaseLabel, "Customer Declined");

    const dismissedTab = mobileAdminExactPlantsPayload(
      [eligible, listed],
      [dismissed],
      "dismissed",
    );
    assert.equal(dismissedTab.items.length, 1);
    assert.equal(dismissedTab.items[0].canList, false);
    assert.equal(dismissedTab.items[0].listingLabel, "Dismissed");

    const row = toMobileExactPlantRow(listed);
    assert.equal(row.canDismiss, false);
    assert.equal(row.listingLabel, "Listed");
  });

  it("wires token create and revoke onto Settings", () => {
    const settings = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    assert.match(settings, /create-mobile-token/);
    assert.match(settings, /revoke-mobile-token/);
    assert.match(settings, /iOS admin app/);
    assert.match(settings, /save-admin-emails/);
    assert.match(settings, /adminEmailNewRequest/);
    assert.match(settings, /adminEmailCustomerResponse/);
    assert.match(settings, /adminEmailPaymentAfterVoid/);
  });

  it("does not ask Shopify to email the draft-order invoice", () => {
    const shopifyOps = readFileSync(
      path.join(import.meta.dirname, "shopify-ops.server.ts"),
      "utf8",
    );
    assert.match(shopifyOps, /portal never[\s\S]*calls draftOrderInvoiceSend/);
    assert.doesNotMatch(shopifyOps, /draftOrderInvoiceSend\s*\(/);
    assert.doesNotMatch(shopifyOps, /SendPlantRequestInvoice/);
  });

  it("puts EXACT PLANTS and Settings on the iPhone app tabs", () => {
    const iosRoot = path.join(import.meta.dirname, "..", "..", "mobile", "ios-admin");
    const app = readFileSync(path.join(iosRoot, "App.tsx"), "utf8");
    const list = readFileSync(path.join(iosRoot, "src", "screens", "RequestListScreen.tsx"), "utf8");
    const detail = readFileSync(
      path.join(iosRoot, "src", "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    const iosPackage = readFileSync(path.join(iosRoot, "package.json"), "utf8");
    assert.match(app, /ExactPlants/);
    assert.match(app, /ExactPlantsScreen/);
    assert.match(app, /SettingsScreen/);
    assert.match(list, /StatusPills/);
    assert.match(detail, /shippingFeeOverride/);
    assert.match(detail, /Existing order:/);
    assert.match(iosPackage, /"expo": "~54\./);
    assert.doesNotMatch(iosPackage, /"expo": "~52\./);
  });
});
