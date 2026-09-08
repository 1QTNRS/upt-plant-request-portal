import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildDraftOrderInput,
  buildDraftOrderNote,
  customerDeclinedFedExUpgrade,
  formatOfferExpirationUrgencyPill,
  isOfferExpired,
  requestShowsAnsweredPill,
  shouldGroupTerminalPlantItems,
} from "./portal";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

function hoursFromNow(hours: number, now = new Date("2026-09-08T12:00:00.000Z")) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

describe("customer request form helper text", () => {
  it("renders the exact PLANTS REQUESTED helper line", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "app", "components", "customer-request-portal.tsx"),
      "utf8",
    );
    assert.match(source, />PLANTS REQUESTED</);
    assert.match(
      source,
      /Please enter one plant per box\. Add a new box for each additional plant\./,
    );
  });
});

describe("offer expiration urgency", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("uses day buckets when 24 hours or more remain", () => {
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(50, now), now), "<3 days");
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(30, now), now), "<2 days");
  });

  it("uses hour buckets under 24 hours", () => {
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(15, now), now), "<1 day");
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(8, now), now), "<12 hrs");
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(3, now), now), "<6 hrs");
    assert.equal(formatOfferExpirationUrgencyPill(hoursFromNow(1, now), now), "<2 hrs");
  });

  it("shows Expired without a negative countdown", () => {
    assert.equal(
      formatOfferExpirationUrgencyPill(hoursFromNow(-1, now), now),
      "Expired",
    );
    assert.equal(isOfferExpired(hoursFromNow(-1, now), now), true);
  });
});

describe("Declined FedEx draft order notes", () => {
  it("appends Declined FedEx only for an explicit decline with accepted plants", () => {
    assert.equal(
      buildDraftOrderNote({ requestNumber: "REQ123", declinedFedEx: true }),
      "UPT plant request REQ123\nDeclined FedEx",
    );
    assert.equal(
      buildDraftOrderNote({ requestNumber: "REQ123" }),
      "UPT plant request REQ123",
    );
    assert.equal(
      customerDeclinedFedExUpgrade({
        acceptedPurchasableCount: 0,
        fedexUpgradeSelected: false,
      }),
      false,
    );
    assert.equal(
      customerDeclinedFedExUpgrade({
        acceptedPurchasableCount: 2,
        fedexUpgradeSelected: false,
      }),
      true,
    );
    assert.equal(
      customerDeclinedFedExUpgrade({
        acceptedPurchasableCount: 2,
        fedexUpgradeSelected: true,
      }),
      false,
    );
  });

  it("does not duplicate Declined FedEx in the note builder", () => {
    const note = buildDraftOrderNote({
      requestNumber: "REQ123",
      declinedFedEx: true,
    });
    assert.equal(note.split("Declined FedEx").length - 1, 1);
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ123",
      customerEmail: "a@example.com",
      currencyCode: "USD",
      lineItems: [],
      declinedFedEx: true,
    });
    assert.equal(input.note, note);
  });
});

describe("Answered pill derivation", () => {
  it("shows only for Pending requests with a submitted response", () => {
    assert.equal(requestShowsAnsweredPill("Pending", true), true);
    assert.equal(requestShowsAnsweredPill("Pending", false), false);
    assert.equal(requestShowsAnsweredPill("Closed", true), false);
    assert.equal(requestShowsAnsweredPill("New", true), false);
  });
});

describe("accepted vs declined grouping", () => {
  it("groups Pending requests after the customer answers", () => {
    assert.equal(
      shouldGroupTerminalPlantItems("Pending", [
        { sourceItemId: "a", choice: "accept" },
      ]),
      true,
    );
    assert.equal(
      shouldGroupTerminalPlantItems("Pending", [
        { sourceItemId: "a", choice: "unavailable" },
      ]),
      false,
    );
    assert.equal(shouldGroupTerminalPlantItems("New", []), false);
  });
});

describe("cross-platform batch 3 wiring", () => {
  it("keeps Exact Plants request detail inside the Exact Plants stack", () => {
    const app = readFileSync(path.join(REPO_ROOT, "mobile", "ios-admin", "App.tsx"), "utf8");
    const exact = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "screens", "ExactPlantsScreen.tsx"),
      "utf8",
    );
    const navTypes = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "screens", "navigation-types.ts"),
      "utf8",
    );
    assert.match(app, /ExactPlantsStack\.Screen name="RequestDetail"/);
    assert.match(navTypes, /RequestDetail: RequestDetailParams/);
    assert.match(exact, /navigation\.navigate\("RequestDetail"/);
    assert.doesNotMatch(exact, /navigate\("Requests"/);
  });

  it("shows expiration and Answered UI on web and iOS admin", () => {
    const webDetail = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const webList = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app._index.tsx"),
      "utf8",
    );
    const iosDetail = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    const pills = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "StatusPills.tsx"),
      "utf8",
    );
    assert.match(webDetail, /OfferExpirationDisplay/);
    assert.match(webDetail, /requestShowsAnsweredPill/);
    assert.match(webList, /hasResponded={request\.hasResponded}/);
    assert.match(iosDetail, /formatOfferExpirationUrgencyPill/);
    assert.match(pills, /Answered/);
  });

  it("makes customer notes stand out before fulfillment controls", () => {
    const ios = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "components", "ItemEditor.tsx"),
      "utf8",
    );
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(ios, /customerNotesBox/);
    assert.match(ios, /fulfillmentButtons/);
    assert.match(web, /Customer notes/);
  });
});
