import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  mobileAdminDashboardPayload,
  toMobileAdminRequestDetail,
} from "./admin-mobile-api";
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

  it("wires token create and revoke onto Settings", () => {
    const settings = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    assert.match(settings, /create-mobile-token/);
    assert.match(settings, /revoke-mobile-token/);
    assert.match(settings, /iOS admin app/);
  });
});
