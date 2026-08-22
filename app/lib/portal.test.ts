import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdminResponseEmail,
  buildDraftOrderLineItems,
  buildExpirationReminderEmail,
  buildOfferReadyEmail,
  buildResponseSummaryEmail,
  computeBehaviorFlags,
  formatCustomerStatusLabel,
  formatRequestNumber,
  getDisplayRequestNumber,
  incompleteOfferItems,
  isOfferExpired,
  matchesAdminSearch,
  normalizeRequestStatus,
  normalizeUnavailableReason,
  offerHasPayableItems,
  offerReadinessMessage,
  parseRequestNumber,
  plantRevenueFromLines,
  plantRevenueFromPaidOrderLines,
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

describe("status mapping", () => {
  it("keeps the four stored statuses", () => {
    assert.equal(normalizeRequestStatus("Pending"), "Pending");
    assert.equal(formatCustomerStatusLabel("New"), "New");
    assert.equal(normalizeRequestStatus("Purchased"), "Closed");
    assert.equal(normalizeRequestStatus("Offer Sent"), "Pending");
  });

  /*
   * The stored status stays Pending — closing these requests would drop their
   * declined plants out of the EXACT PLANTS review queue — so the label is what
   * has to say where the customer stands.
   */
  it("derives every customer-facing label from Pending", () => {
    assert.equal(
      formatCustomerStatusLabel("Pending", {
        hasPayableItems: true,
        hasResponded: false,
      }),
      "Offer Ready for Review",
      "an offer they have not read is not a bill",
    );
    assert.equal(
      formatCustomerStatusLabel("Pending", {
        hasPayableItems: true,
        hasResponded: true,
      }),
      "Needs Payment",
    );
    assert.equal(
      formatCustomerStatusLabel("Pending", {
        hasPayableItems: false,
        hasResponded: true,
      }),
      "No Payment Needed",
    );
    assert.equal(
      formatCustomerStatusLabel("Pending", {
        hasPayableItems: false,
        hasResponded: false,
      }),
      "No Payment Needed",
      "UPT had nothing available, so there was never anything to buy",
    );
    // Knowing nothing about the answer is not evidence that money is owed.
    assert.equal(formatCustomerStatusLabel("Pending", {}), "Offer Ready for Review");
  });

  it("leaves the terminal statuses as they are stored", () => {
    assert.equal(
      formatCustomerStatusLabel("Closed", {
        hasPayableItems: false,
        hasResponded: true,
      }),
      "Closed",
    );
    assert.equal(
      formatCustomerStatusLabel("Expired", {
        hasPayableItems: true,
        hasResponded: false,
      }),
      "Expired",
    );
  });

  it("decides what is payable from the offer and the answer", () => {
    const available = { availability: "available" };
    const notAvailable = { availability: "not_available" };

    // Unanswered: the customer can still accept until the hold ends.
    assert.equal(
      offerHasPayableItems({ offerItems: [available, notAvailable] }),
      true,
    );
    assert.equal(
      offerHasPayableItems({ offerItems: [notAvailable, notAvailable] }),
      false,
      "UPT had nothing available, so there was never anything to buy",
    );
    assert.equal(
      offerHasPayableItems({
        offerItems: [available, available],
        responseChoices: ["reject", "reject"],
      }),
      false,
    );
    assert.equal(
      offerHasPayableItems({
        offerItems: [available, available],
        responseChoices: ["reject", "accept"],
      }),
      true,
    );
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

/**
 * The fallback for a paid request with no recorded draft order, so there is no
 * `kind` to read and the order's own lines are all there is.
 */
describe("plant revenue from a paid order's lines", () => {
  const fedexVariant = "gid://shopify/ProductVariant/44556677";
  const identity = {
    variantGid: fedexVariant,
    upgradeLabel: "FedEx Priority Overnight Upgrade",
    upgradeSelected: true,
  };

  it("excludes the upgrade line the merchant renamed", () => {
    const result = plantRevenueFromPaidOrderLines(
      [
        { title: "Philodendron Spiritus Sancti", price: "400.00", quantity: 1 },
        {
          title: "Express Shipping Guarantee",
          price: "15.00",
          quantity: 1,
          variant_id: 44556677,
        },
      ],
      identity,
    );
    assert.equal(result.plantRevenue, 400);
    assert.equal(result.fedexLineCount, 1);
    assert.equal(result.unidentifiedUpgrade, false);
  });

  it("counts a plant whose offered name contains Fedex", () => {
    // The mirror image: the title substrings dropped this $300 plant and kept
    // the $15 shipping line instead.
    const result = plantRevenueFromPaidOrderLines(
      [
        { title: "Renamed Fedex Exact", price: "300.00", quantity: 1 },
        {
          title: "Express Shipping Guarantee",
          price: "15.00",
          quantity: 1,
          admin_graphql_api_variant_id: fedexVariant,
        },
      ],
      identity,
    );
    assert.equal(result.plantRevenue, 300);
  });

  it("falls back to the stored upgrade label when the line carries no variant", () => {
    // A custom line, which is what the app sends before it has resolved the
    // FedEx variant on the store.
    const result = plantRevenueFromPaidOrderLines(
      [
        { title: "Monstera Albo Exact", price: "250.00", quantity: 1 },
        { title: "FedEx Priority Overnight Upgrade", price: "15.00", quantity: 1 },
      ],
      { upgradeLabel: identity.upgradeLabel, upgradeSelected: true },
    );
    assert.equal(result.plantRevenue, 250);
    assert.equal(result.fedexLineCount, 1);
  });

  it("counts every line when the customer removed the upgrade", () => {
    const result = plantRevenueFromPaidOrderLines(
      [{ title: "Fedex Special Exact", price: "120.00", quantity: 2 }],
      { ...identity, upgradeSelected: false },
    );
    assert.equal(result.plantRevenue, 240);
    assert.equal(result.unidentifiedUpgrade, false);
  });

  it("reports an upgrade it cannot find rather than guessing at one", () => {
    // Over-stating revenue by the shipping charge is recoverable; silently
    // dropping a plant from every revenue figure is not.
    const result = plantRevenueFromPaidOrderLines(
      [
        { title: "Anthurium Warocqueanum Exact", price: "500.00", quantity: 1 },
        { title: "Express Shipping Guarantee", price: "15.00", quantity: 1 },
      ],
      { variantGid: fedexVariant, upgradeLabel: "Renamed Upgrade", upgradeSelected: true },
    );
    assert.equal(result.plantRevenue, 515);
    assert.equal(result.unidentifiedUpgrade, true);
  });
});

describe("the one email a customer gets for their answer", () => {
  const accepted = {
    plantName: "Monstera Deliciosa",
    price: 85,
    customerNotes: "Minor leaf damage.",
  };
  const declined = {
    plantName: "Fiddle Leaf Fig",
    price: 60,
    customerNotes: "Two lower leaves are yellowing.",
  };

  it("carries the accepted plants, the declined ones, FedEx and one payment link", () => {
    const email = buildResponseSummaryEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      acceptedItems: [accepted],
      rejectedItems: [declined],
      fedexSelected: false,
      fedexPrice: 15,
      fedexDisclaimer: "Standard shipping is not covered.",
      invoiceUrl: "https://checkout.example/pay",
      expiresAt: "Aug 26, 2026, 10:02 PM UTC",
    });

    assert.match(email.bodyText, /Monstera Deliciosa — \$85\.00 Notes: Minor leaf damage\./);
    assert.match(email.bodyText, /Fiddle Leaf Fig — \$60\.00/);
    assert.match(email.bodyText, /Two lower leaves are yellowing/);
    assert.match(email.bodyText, /FedEx Priority Overnight Upgrade: removed/);
    assert.match(email.bodyText, /Standard shipping is not covered/);
    assert.match(email.bodyText, /held for you until Aug 26, 2026/);
    assert.equal(
      email.bodyText.match(/https:\/\/checkout\.example\/pay/g)?.length,
      1,
      "one checkout link, not one per email",
    );
  });

  it("says the upgrade was kept when the customer kept it", () => {
    const email = buildResponseSummaryEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      acceptedItems: [accepted],
      rejectedItems: [],
      fedexSelected: true,
      fedexPrice: 15,
      invoiceUrl: "https://checkout.example/pay",
    });

    assert.match(email.bodyText, /FedEx Priority Overnight Upgrade: kept \(\$15\.00\)/);
  });

  it("asks for nothing when the customer accepted nothing", () => {
    const email = buildResponseSummaryEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      acceptedItems: [],
      rejectedItems: [accepted, declined],
      fedexSelected: true,
      fedexPrice: 15,
      invoiceUrl: "https://checkout.example/pay",
    });

    assert.match(email.subject, /no payment needed/i);
    assert.match(email.bodyText, /no payment is needed/i);
    assert.match(email.bodyText, /Monstera Deliciosa — \$85\.00/);
    assert.match(email.bodyText, /Fiddle Leaf Fig — \$60\.00/);
    assert.doesNotMatch(email.bodyText, /checkout\.example/);
    assert.doesNotMatch(
      email.bodyText,
      /FedEx/,
      "nothing ships, so there is no upgrade to charge for or disclaim",
    );
  });
});

describe("the offer-ready email", () => {
  const email = buildOfferReadyEmail({
    customerName: "Alex Rivera",
    requestNumber: "REQ1",
    expiresAt: "Aug 26, 2026, 10:02 PM UTC",
    offerLink: "https://shop.example.com/apps/plant-requests/requests/req-1",
  });

  it("says UPT has responded and links straight to the offer", () => {
    assert.match(email.subject, /UPT has responded/);
    assert.match(email.bodyText, /UPT has responded to your plant request REQ1/);
    assert.match(email.bodyText, /apps\/plant-requests\/requests\/req-1/);
  });

  it("does not ask for payment before the offer has been read", () => {
    // They may decline every plant on it.
    assert.doesNotMatch(email.subject, /pay/i);
    assert.doesNotMatch(email.bodyText, /payment|invoice|checkout/i);
  });
});

describe("the admin response email", () => {
  it("is one message naming the request and whether anything was accepted", () => {
    const email = buildAdminResponseEmail({
      requestNumber: "REQ1",
      customerName: "Alex Rivera",
      customerEmail: "alex.rivera@example.com",
      acceptedCount: 2,
      rejectedCount: 1,
    });

    assert.match(email.subject, /^REQ1: customer responded/);
    assert.match(email.subject, /2 of 3 item\(s\) accepted/);
    assert.match(email.bodyText, /alex\.rivera@example\.com/);
  });

  it("says plainly when everything was declined", () => {
    const email = buildAdminResponseEmail({
      requestNumber: "REQ2",
      customerName: "Alex Rivera",
      customerEmail: "alex.rivera@example.com",
      acceptedCount: 0,
      rejectedCount: 3,
    });

    assert.match(email.subject, /every item declined/);
    assert.match(email.bodyText, /declined all 3 item\(s\)/);
    assert.match(email.bodyText, /no draft order was created/);
  });
});

describe("an offer cannot be sent on an incomplete item", () => {
  const ready = {
    plantName: "Monstera Albo",
    offeredName: "Monstera Albo Exact",
    availability: "available",
    price: 250,
    weightLbs: 2,
    photos: [{ id: "photo-1" }],
  };

  it("passes an Available item that has a photo, a price and a weight", () => {
    assert.deepEqual(incompleteOfferItems([ready]), []);
  });

  it("still offers an item with no customer-facing notes", () => {
    // Notes are editorial. Plenty of plants have nothing to disclose.
    assert.deepEqual(
      incompleteOfferItems([{ ...ready, offeredName: null }]),
      [],
    );
  });

  it("requires nothing of a Not Available item", () => {
    assert.deepEqual(
      incompleteOfferItems([
        {
          plantName: "String of Pearls",
          availability: "not_available",
          price: 0,
          weightLbs: 0,
          photos: [],
        },
      ]),
      [],
    );
  });

  it("names each item and the fields it lacks", () => {
    const problems = incompleteOfferItems([
      ready,
      { ...ready, plantName: "Hoya", offeredName: "", photos: [] },
      {
        plantName: "Anthurium",
        offeredName: "Anthurium Warocqueanum",
        availability: "available",
        price: 0,
        weightLbs: 0,
        photos: [{ id: "photo-2" }],
      },
    ]);

    assert.deepEqual(problems, [
      { itemName: "Hoya", missing: ["an exact plant photo"] },
      {
        itemName: "Anthurium Warocqueanum",
        missing: ["a price", "a weight"],
      },
    ]);

    const message = offerReadinessMessage(problems);
    assert.match(message, /Hoya is missing an exact plant photo\./);
    assert.match(
      message,
      /Anthurium Warocqueanum is missing a price and a weight\./,
    );
    assert.doesNotMatch(message, /Monstera/);
  });

  it("has nothing to say about a complete offer", () => {
    assert.equal(offerReadinessMessage([]), "");
  });
});

describe("expiration reminder email", () => {
  const base = {
    customerName: "Alex Rivera",
    requestNumber: "REQ1",
    expiresAt: "2026-08-22T12:00:00.000Z",
    offerLink: "https://shop.example.com/apps/plant-requests/requests/req-1",
  };

  it("asks an unanswered customer to review the offer", () => {
    const email = buildExpirationReminderEmail(base);
    assert.match(email.subject, /expires soon/);
    assert.match(email.bodyText, /Review your offer/);
    assert.match(email.bodyText, /apps\/plant-requests/);
  });

  it("leads with the payment link when the customer already accepted", () => {
    // This is the last thing they hear before the hold lapses, and "review your
    // offer" is not what someone who has already accepted needs to do.
    const email = buildExpirationReminderEmail({
      ...base,
      invoiceUrl: "https://shop.example.com/invoices/abc123",
    });

    assert.match(email.subject, /complete payment/i);
    assert.ok(
      email.bodyText.indexOf("https://shop.example.com/invoices/abc123") <
        email.bodyText.indexOf(base.offerLink),
    );
    assert.doesNotMatch(email.bodyText, /Review your offer/);
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

describe("expiration reminder wording", () => {
  it("gives the customer a readable date, not a machine timestamp", () => {
    const email = buildExpirationReminderEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ13",
      expiresAt: "Aug 26, 2026, 10:02 PM UTC",
      offerLink: "https://shop.myshopify.com/apps/plant-requests/requests/req_1",
    });

    assert.match(email.bodyText, /Aug 26, 2026, 10:02 PM UTC/);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(email.bodyText));
  });
});
