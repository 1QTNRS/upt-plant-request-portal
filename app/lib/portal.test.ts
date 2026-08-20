import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConfirmationEmail,
  buildDraftOrderLineItems,
  computeBehaviorFlags,
  formatCustomerStatusLabel,
  formatRequestNumber,
  getDisplayRequestNumber,
  isOfferExpired,
  matchesAdminSearch,
  normalizeRequestStatus,
  normalizeUnavailableReason,
  parseRequestNumber,
  plantRevenueFromLines,
  primaryBehaviorFlag,
  computeTimeRemaining,
} from "./portal";

describe("request numbers", () => {
  it("formats sequential request numbers as REQ1, REQ2, REQ2178", () => {
    assert.equal(formatRequestNumber(1), "REQ1");
    assert.equal(formatRequestNumber(2), "REQ2");
    assert.equal(formatRequestNumber(2178), "REQ2178");
    assert.equal(parseRequestNumber("REQ2178"), 2178);
    assert.equal(parseRequestNumber("UPT-REQ-2026-000041"), 41);
    assert.equal(
      getDisplayRequestNumber({ id: "x", requestNumber: "UPT-REQ-2026-000001" }),
      "REQ1",
    );
    assert.equal(
      getDisplayRequestNumber({ id: "x", requestNumber: "REQ8" }),
      "REQ8",
    );
  });
});
  it("keeps Pending stored while displaying Needs Payment", () => {
    assert.equal(normalizeRequestStatus("Pending"), "Pending");
    assert.equal(formatCustomerStatusLabel("Pending"), "Needs Payment");
    assert.equal(formatCustomerStatusLabel("New"), "New");
    assert.equal(normalizeRequestStatus("Purchased"), "Closed");
    assert.equal(normalizeRequestStatus("Offer Sent"), "Pending");
  });

  it("normalizes unavailable reason labels to the production set", () => {
    assert.equal(
      normalizeUnavailableReason("Available in 2-3 weeks"),
      "available in 2-3weeks",
    );
    assert.equal(
      normalizeUnavailableReason("Not in UPT's current inventory"),
      "not in our current inventory",
    );
  });
});

describe("admin search", () => {
  const request = {
    customer: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    requestNumber: "REQ41",
    items: [{ plantName: "Monstera Deliciosa", offeredName: "Monstera Exact" }],
  };

  it("matches customer name, plant text, and request number", () => {
    assert.equal(matchesAdminSearch(request, "sarah"), true);
    assert.equal(matchesAdminSearch(request, "monstera"), true);
    assert.equal(matchesAdminSearch(request, "REQ41"), true);
    assert.equal(matchesAdminSearch(request, "41"), true);
    assert.equal(matchesAdminSearch(request, "exact"), true);
    assert.equal(matchesAdminSearch(request, "calathea"), false);
  });
});

describe("expiration", () => {
  it("detects expired offers and formats remaining time", () => {
    const past = new Date("2026-01-01T00:00:00Z").toISOString();
    const future = new Date("2026-01-04T12:00:00Z").toISOString();
    const now = new Date("2026-01-01T12:00:00Z");

    assert.equal(isOfferExpired(past, now), true);
    assert.equal(isOfferExpired(future, now), false);
    assert.match(computeTimeRemaining(future, now) ?? "", /day/);
  });
});

describe("draft orders", () => {
  it("includes accepted plants with quantity, price, and weight, plus FedEx when selected", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [
        {
          plantName: "Monstera Exact",
          quantity: 1,
          price: 85,
          weightLbs: 12.4,
        },
      ],
      fedexSelected: true,
      fedexLabel: "FedEx Priority Overnight Upgrade",
      fedexPrice: 15,
    });

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      title: "Monstera Exact",
      quantity: 1,
      price: 85,
      weightLbs: 12.4,
      kind: "plant",
    });
    assert.equal(lines[1]?.kind, "fedex");
    assert.equal(plantRevenueFromLines(lines), 85);
  });

  it("excludes FedEx when the customer removed it and never includes rejected items", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [],
      fedexSelected: true,
      fedexLabel: "FedEx Priority Overnight Upgrade",
      fedexPrice: 15,
    });
    assert.deepEqual(lines, []);
  });
});

describe("confirmation email", () => {
  it("includes accepted items only, FedEx disclaimer when removed, and checkout link", () => {
    const email = buildConfirmationEmail({
      customerName: "Alex Rivera",
      customerEmail: "alex.rivera@example.com",
      requestNumber: "REQ1",
      acceptedItems: [
        {
          plantName: "Monstera Deliciosa",
          price: 85,
          quantity: 1,
          customerNotes: "Minor leaf damage.",
        },
      ],
      fedexSelected: false,
      fedexPrice: 15,
      fedexDisclaimer: "Standard shipping is not covered.",
      invoiceUrl: "https://checkout.example/pay",
    });

    assert.match(email.bodyText, /Monstera Deliciosa/);
    assert.match(email.bodyText, /Minor leaf damage/);
    assert.match(email.bodyText, /FedEx Priority Overnight Upgrade: removed/);
    assert.match(email.bodyText, /Standard shipping is not covered/);
    assert.match(email.bodyText, /https:\/\/checkout.example\/pay/);
    assert.doesNotMatch(email.bodyText, /Rejected/);
    assert.doesNotMatch(email.bodyText, /Fiddle Leaf/);
  });
});

describe("behavior flags", () => {
  it("flags high request / low purchase for 10 requested and 2 purchased", () => {
    const flags = computeBehaviorFlags({
      totalRequests: 2,
      offersSent: 2,
      itemsRequested: 10,
      itemsOffered: 8,
      itemsAccepted: 4,
      itemsPurchased: 2,
      closedPaidRequests: 1,
      expiredRequests: 0,
      totalRevenue: 180,
    });

    assert.ok(flags.includes("High Request / Low Purchase"));
    assert.equal(primaryBehaviorFlag(flags), "High Request / Low Purchase");
  });

  it("flags approval drop-off when accepted items were never purchased", () => {
    const flags = computeBehaviorFlags({
      totalRequests: 1,
      offersSent: 1,
      itemsRequested: 3,
      itemsOffered: 3,
      itemsAccepted: 3,
      itemsPurchased: 0,
      closedPaidRequests: 0,
      expiredRequests: 0,
      totalRevenue: 0,
    });

    assert.ok(flags.includes("Approval Drop-Off"));
    assert.equal(primaryBehaviorFlag(flags), "Approval Drop-Off");
  });
});
