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
  });

  it("keeps admin notes and photos on the detail payload", () => {
    const detail = toMobileAdminRequestDetail(request());
    assert.equal(detail.requestNumber, "REQ12");
    assert.equal(detail.items[0].adminNotes, "internal only");
    assert.deepEqual(detail.items[0].photoUrls, ["https://cdn.shopify.com/albo.jpg"]);
    assert.deepEqual(detail.items[0].photos, []);
    assert.equal(detail.items[0].unavailableReason, undefined);
    assert.equal(detail.canEditItems, false);
    assert.equal(detail.canSendOffer, false);
    assert.equal(detail.canOverrideClose, true);
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
  });

  it("puts EXACT PLANTS and Settings on the iPhone app tabs", () => {
    const app = readFileSync(
      path.join(import.meta.dirname, "..", "..", "mobile", "ios-admin", "App.tsx"),
      "utf8",
    );
    assert.match(app, /exact-plants/);
    assert.match(app, /ExactPlantsScreen/);
    assert.match(app, /SettingsScreen/);
  });
});
