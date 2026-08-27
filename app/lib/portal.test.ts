import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdminPaymentAfterVoidEmail,
  buildAdminResponseEmail,
  buildDraftOrderInput,
  buildDraftOrderLineItems,
  buildExpirationReminderEmail,
  buildOfferReadyEmail,
  buildResponseSummaryEmail,
  ADMIN_OVERRIDE_CLOSE_REASON,
  CUSTOMER_SUPPORT_EMAIL,
  FEDEX_PRODUCT_SKU,
  fedexVariantSkuQuery,
  INVOICE_VOIDED_BY_ADMIN_REASON,
  INVOICE_VOIDED_REASON,
  PAYMENT_AFTER_VOID_REASON,
  adminDraftOrderLinkState,
  payableInvoiceUrl,
  shopifyAdminDraftOrderUrl,
  shouldOfferAdminPaymentLinkRecovery,
  shouldRenderCustomerSupportNote,
  showCustomerSupportNote,
  computeBehaviorFlags,
  customerStatusTone,
  formatCustomerStatusLabel,
  formatRequestNumber,
  getDisplayRequestNumber,
  getOfferHoldMessage,
  getOfferUrgencyMessage,
  incompleteOfferItems,
  isOfferExpired,
  adminDashboardFilterLabel,
  countAdminDashboardStatusFilters,
  filterAdminDashboardRequests,
  matchesAdminSearch,
  matchesAnalyticsCustomerSearch,
  parseAdminDashboardStatusFilter,
  parseShippingFeeOverride,
  adminSubscribedToEmail,
  OVERRIDDEN_SHIPPING_LINE_TITLE,
  responseSnapshotListingImage,
  responseSnapshotPhotoUrls,
  summarizeAdminDashboardStats,
  normalizeRequestStatus,
  normalizeUnavailableReason,
  UNAVAILABLE_REASON_OPTIONS,
  itemsHavePurchasableOffer,
  offerHasPayableItems,
  sendOfferHoldControlsEnabled,
  offerIsAllExactPlants,
  offerReadinessMessage,
  parseRequestNumber,
  plantRevenueFromLines,
  plantRevenueFromPaidOrderLines,
  primaryBehaviorFlag,
  reserveInventoryUntilFor,
  variantBackedLines,
  computeTimeRemaining,
} from "./portal";

describe("FedEx listing identity", () => {
  it("identifies the live UPT upgrade by SKU", () => {
    assert.equal(FEDEX_PRODUCT_SKU, "UPTUPGTOFED1236S");
    assert.equal(fedexVariantSkuQuery(), "sku:UPTUPGTOFED1236S");
  });
});

describe("admin email subscriptions", () => {
  const allOn = {
    adminEmailNewRequest: true,
    adminEmailCustomerResponse: true,
    adminEmailPaymentAfterVoid: true,
  };

  it("honours each Settings checkbox independently", () => {
    assert.equal(adminSubscribedToEmail(allOn, "admin_new_request"), true);
    assert.equal(
      adminSubscribedToEmail(
        { ...allOn, adminEmailNewRequest: false },
        "admin_new_request",
      ),
      false,
    );
    assert.equal(
      adminSubscribedToEmail(
        { ...allOn, adminEmailCustomerResponse: false },
        "admin_response",
      ),
      false,
    );
    assert.equal(
      adminSubscribedToEmail(
        { ...allOn, adminEmailPaymentAfterVoid: false },
        "admin_payment_after_void",
      ),
      false,
    );
  });
});

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
    assert.equal(
      customerStatusTone("Pending", { hasResponded: false, hasPayableItems: true }),
      "caution",
    );
    assert.equal(
      customerStatusTone("Pending", { hasResponded: true, hasPayableItems: true }),
      "warning",
    );
    assert.equal(
      customerStatusTone("Pending", { hasPayableItems: false }),
      "info",
    );
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

  it("enables Send Offer hold controls only when something is purchasable", () => {
    assert.equal(
      itemsHavePurchasableOffer([{ availability: "not_available" }]),
      false,
    );
    assert.equal(
      sendOfferHoldControlsEnabled([{ availability: "not_available" }]),
      false,
    );
    assert.equal(
      sendOfferHoldControlsEnabled([
        { availability: "not_available" },
        { availability: "available" },
      ]),
      true,
      "one Available item turns expiration and ADD ON back on",
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
    assert.equal(normalizeUnavailableReason("other"), "other");
    assert.equal(normalizeUnavailableReason("Other"), "other");
    assert.ok(UNAVAILABLE_REASON_OPTIONS.includes("other"));
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

describe("analytics customer search", () => {
  const customer = {
    customerName: "Alex Rivera",
    email: "alex.rivera@example.com",
  };

  it("matches name or email and ignores surrounding space", () => {
    assert.equal(matchesAnalyticsCustomerSearch("", customer), true);
    assert.equal(matchesAnalyticsCustomerSearch("  alex  ", customer), true);
    assert.equal(matchesAnalyticsCustomerSearch("RIVERA", customer), true);
    assert.equal(matchesAnalyticsCustomerSearch("example.com", customer), true);
    assert.equal(matchesAnalyticsCustomerSearch("sarah", customer), false);
  });
});

describe("admin dashboard status filter", () => {
  const requests = [
    {
      status: "New" as const,
      customer: "Alex Rivera",
      email: "alex@example.com",
      requestNumber: "REQ1",
      items: [{ plantName: "Monstera" }],
    },
    {
      status: "New" as const,
      customer: "David Wilson",
      email: "david@example.com",
      requestNumber: "REQ6",
      items: [{ plantName: "Hoya" }],
      hasExistingOrder: true,
    },
    {
      status: "Pending" as const,
      customer: "Alex Rivera",
      email: "alex@example.com",
      requestNumber: "REQ2",
      items: [{ plantName: "Philodendron" }],
      hasExistingOrder: true,
    },
    {
      status: "Pending" as const,
      customer: "Sarah Mitchell",
      email: "sarah@example.com",
      requestNumber: "REQ3",
      items: [{ plantName: "Calathea" }],
    },
    {
      status: "Expired" as const,
      customer: "Jordan Lee",
      email: "jordan@example.com",
      requestNumber: "REQ4",
      items: [{ plantName: "Hoya" }],
    },
    {
      status: "Closed" as const,
      customer: "Alex Rivera",
      email: "alex@example.com",
      requestNumber: "REQ5",
      items: [{ plantName: "Anthurium" }],
    },
  ];

  it("defaults missing or unknown values to All", () => {
    assert.equal(parseAdminDashboardStatusFilter(null), "All");
    assert.equal(parseAdminDashboardStatusFilter(""), "All");
    assert.equal(parseAdminDashboardStatusFilter("pending"), "All");
    assert.equal(parseAdminDashboardStatusFilter("Pending"), "Pending");
    assert.equal(parseAdminDashboardStatusFilter("ExistingOrder"), "ExistingOrder");
    assert.equal(adminDashboardFilterLabel("ExistingOrder"), "Existing Order");
  });

  it("falls back to offer photos when an older response stored none", () => {
    assert.deepEqual(
      responseSnapshotPhotoUrls([], ["https://cdn.example/one.jpg"]),
      ["https://cdn.example/one.jpg"],
    );
    assert.deepEqual(
      responseSnapshotPhotoUrls(
        ["https://cdn.example/response.jpg"],
        ["https://cdn.example/offer.jpg"],
      ),
      ["https://cdn.example/response.jpg"],
    );
    assert.equal(
      responseSnapshotListingImage(null, "https://cdn.example/listing.jpg"),
      "https://cdn.example/listing.jpg",
    );
  });

  it("counts each dashboard status filter from the full list", () => {
    assert.deepEqual(countAdminDashboardStatusFilters(requests), {
      All: 6,
      New: 2,
      Pending: 2,
      Expired: 1,
      Closed: 1,
      ExistingOrder: 1,
    });
  });

  it("filters New requests that said they have an existing order", () => {
    const filtered = filterAdminDashboardRequests(requests, "", "ExistingOrder");
    assert.deepEqual(
      filtered.map((request) => request.requestNumber),
      ["REQ6"],
    );
  });

  it("filters the visible list by stored admin status", () => {
    const pending = filterAdminDashboardRequests(requests, "", "Pending");
    assert.deepEqual(
      pending.map((request) => request.requestNumber),
      ["REQ2", "REQ3"],
    );
  });

  it("keeps search and status working together", () => {
    const filtered = filterAdminDashboardRequests(requests, "Alex", "Pending");
    assert.deepEqual(
      filtered.map((request) => request.requestNumber),
      ["REQ2"],
    );
  });

  it("leaves dashboard stat counts on the full dataset", () => {
    const filtered = filterAdminDashboardRequests(requests, "Alex", "Pending");
    const stats = summarizeAdminDashboardStats(requests);
    assert.equal(filtered.length, 1);
    assert.equal(stats.newRequests, 2);
    assert.equal(stats.pending, 2);
    assert.equal(stats.expired, 1);
    assert.equal(stats.closed, 1);
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
          itemId: "item-1",
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

  it("sells a Grower's Choice plant as the real Shopify variant", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [
        {
          itemId: "item-1",
          plantName: "Monstera Thai Constellation",
          quantity: 1,
          price: 285,
          weightLbs: 4.5,
          variantId: "gid://shopify/ProductVariant/1",
        },
      ],
      fedexSelected: false,
      fedexLabel: "FedEx Priority Overnight Upgrade",
      fedexPrice: 15,
    });

    assert.equal(lines[0]?.variantId, "gid://shopify/ProductVariant/1");
    assert.deepEqual(variantBackedLines(lines).map((line) => line.variantId), [
      "gid://shopify/ProductVariant/1",
    ]);
  });

  it("leaves an exact plant as a custom line, having no product in Shopify yet", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [
        {
          itemId: "item-1",
          plantName: "Monstera Albo Exact",
          quantity: 1,
          price: 250,
          weightLbs: 3,
        },
      ],
      fedexSelected: false,
      fedexLabel: "FedEx Priority Overnight Upgrade",
      fedexPrice: 15,
    });

    assert.equal(lines[0]?.variantId, undefined);
    assert.deepEqual(variantBackedLines(lines), []);
  });
});

describe("how long Shopify holds the stock", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const deadline = new Date("2026-08-25T12:00:00.000Z");

  const growersChoiceLine = {
    title: "Monstera Thai Constellation",
    quantity: 1,
    price: 285,
    weightLbs: 4.5,
    kind: "plant" as const,
    variantId: "gid://shopify/ProductVariant/1",
  };
  const exactPlantLine = {
    title: "Monstera Albo Exact",
    quantity: 1,
    price: 250,
    weightLbs: 3,
    kind: "plant" as const,
  };
  const fedexLine = {
    title: "FedEx Priority Overnight Upgrade",
    quantity: 1,
    price: 15,
    weightLbs: 0,
    kind: "fedex" as const,
    variantId: "gid://shopify/ProductVariant/42",
  };

  it("holds it until the customer's own payment deadline, and no longer", () => {
    assert.equal(
      reserveInventoryUntilFor({
        lineItems: [growersChoiceLine, fedexLine],
        holdEndsAt: deadline,
        now,
      }),
      deadline.toISOString(),
    );
  });

  it("holds nothing for an order that sells no store stock", () => {
    // Asking would newly hold the FedEx variant, which is a shipping service
    // and has never been held for anyone.
    assert.equal(
      reserveInventoryUntilFor({
        lineItems: [exactPlantLine, fedexLine],
        holdEndsAt: deadline,
        now,
      }),
      undefined,
    );
  });

  it("asks for nothing when the deadline has already passed", () => {
    assert.equal(
      reserveInventoryUntilFor({
        lineItems: [growersChoiceLine],
        holdEndsAt: new Date("2026-08-20T12:00:00.000Z"),
        now,
      }),
      undefined,
    );
  });

  it("puts the deadline and the real variant into the draft order Shopify receives", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: [growersChoiceLine],
      reserveInventoryUntil: deadline.toISOString(),
    });

    assert.equal(input.reserveInventoryUntil, deadline.toISOString());
    assert.deepEqual(input.lineItems, [
      {
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 1,
        // The amount the customer answered, not whatever the variant costs by
        // the time they open the invoice.
        originalUnitPriceWithCurrency: { amount: "285.00", currencyCode: "USD" },
        requiresShipping: true,
        weight: { value: 4.5, unit: "POUNDS" },
      },
    ]);
  });

  it("sends no reservation field at all when nothing is being held", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: [exactPlantLine],
    });

    assert.equal("reserveInventoryUntil" in input, false);
  });

  it("omits shippingLine when the override is blank so checkout can choose a rate", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: [exactPlantLine],
    });
    assert.equal("shippingLine" in input, false);
  });

  it("puts a custom shipping line on the draft order, including 0", () => {
    const input = buildDraftOrderInput({
      requestId: "req_1",
      requestNumber: "REQ2178",
      customerEmail: "customer@example.com",
      currencyCode: "USD",
      lineItems: [exactPlantLine],
      shippingFeeOverride: 0,
    });
    assert.deepEqual(input.shippingLine, {
      title: OVERRIDDEN_SHIPPING_LINE_TITLE,
      priceWithCurrency: { amount: "0.00", currencyCode: "USD" },
    });
    assert.equal(OVERRIDDEN_SHIPPING_LINE_TITLE, "ADD ON");
  });
});

describe("shipping fee override", () => {
  it("treats a blank field as no override", () => {
    assert.deepEqual(parseShippingFeeOverride(""), { ok: true });
    assert.deepEqual(parseShippingFeeOverride("  "), { ok: true });
    assert.deepEqual(parseShippingFeeOverride(null), { ok: true });
  });

  it("accepts 0 as a real custom shipping amount", () => {
    assert.deepEqual(parseShippingFeeOverride("0"), { ok: true, value: 0 });
    assert.deepEqual(parseShippingFeeOverride("12.5"), { ok: true, value: 12.5 });
  });

  it("rejects a negative or non-numeric amount", () => {
    const negative = parseShippingFeeOverride("-1");
    const text = parseShippingFeeOverride("free");
    assert.equal(negative.ok, false);
    assert.equal(text.ok, false);
    if (!negative.ok) assert.match(negative.error, /ADD ON/);
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
    assert.match(email.bodyText, /Need help with this invoice or need something changed/);
    assert.match(email.bodyText, /support@unsolicitedplanttalks\.com/);
    assert.match(email.bodyText, /follow your request status in the portal/);
    assert.doesNotMatch(email.bodyText, /Contact us for updates/);
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

  it("names a Grower's Choice plant and says once what that means", () => {
    const email = buildResponseSummaryEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      acceptedItems: [
        { ...accepted, fulfillmentType: "growers_choice" as const },
        accepted,
      ],
      rejectedItems: [declined],
      fedexSelected: false,
      fedexPrice: 15,
      invoiceUrl: "https://checkout.example/pay",
    });

    assert.match(
      email.bodyText,
      /Monstera Deliciosa \(Grower's Choice\) — \$85\.00/,
    );
    assert.equal(
      email.bodyText.match(/Grower's Choice means we choose/g)?.length,
      1,
      "explained once under the list, not on every line",
    );
  });

  it("says nothing about Grower's Choice when no plant was on that route", () => {
    // An exact plant is what the offer has always meant, so labelling it would
    // read as a new distinction on every line of every email.
    const email = buildResponseSummaryEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      acceptedItems: [accepted],
      rejectedItems: [declined],
      fedexSelected: false,
      fedexPrice: 15,
      invoiceUrl: "https://checkout.example/pay",
    });

    assert.doesNotMatch(email.bodyText, /Grower's Choice/);
    assert.doesNotMatch(email.bodyText, /Exact Plant/);
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

  it("calls the plants exact only when every one of them is", () => {
    assert.match(email.bodyText, /These exact plants are being held/);
    const mixed = buildOfferReadyEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      expiresAt: "Aug 26, 2026, 10:02 PM UTC",
      offerLink: "https://shop.example.com/apps/plant-requests/requests/req-1",
      allExactPlants: false,
    });
    assert.match(mixed.bodyText, /These plants are being held/);
    assert.doesNotMatch(mixed.bodyText, /exact/i);
  });

  it("summarises available and unavailable plants without a payment link", () => {
    const summarised = buildOfferReadyEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      expiresAt: "Aug 26, 2026, 10:02 PM UTC",
      offerLink: "https://shop.example.com/apps/plant-requests/requests/req-1",
      availableItems: [{ name: "Monstera Albo", notes: "Rooted cutting." }],
      unavailableItems: [
        { name: "Missing Fern", reason: "not in our current inventory" },
      ],
    });
    assert.match(summarised.bodyText, /Available:\n- Monstera Albo — Rooted cutting\./);
    assert.match(
      summarised.bodyText,
      /Unavailable:\n- Missing Fern \(not in our current inventory\)/,
    );
    assert.doesNotMatch(summarised.bodyText, /payment|invoice|checkout/i);
  });

  it("thanks the customer when nothing is available and still has no payment link", () => {
    const none = buildOfferReadyEmail({
      customerName: "Alex Rivera",
      requestNumber: "REQ1",
      expiresAt: "Aug 26, 2026, 10:02 PM UTC",
      offerLink: "https://shop.example.com/apps/plant-requests/requests/req-1",
      availableItems: [],
      unavailableItems: [
        { name: "Missing Fern", reason: "not in our current inventory" },
      ],
    });
    assert.match(none.bodyText, /None of the requested plants are available/);
    assert.match(none.bodyText, /No payment is needed/);
    assert.doesNotMatch(none.bodyText, /being held/);
    assert.doesNotMatch(none.bodyText, /invoice|checkout/i);
  });
});

describe("naming what is on offer", () => {
  const exactPlant = { availability: "available", fulfillmentType: "exact_plant" };
  const growersChoice = { availability: "available", fulfillmentType: "growers_choice" };

  it("promises an exact plant only when no line comes from store stock", () => {
    assert.equal(offerIsAllExactPlants([exactPlant, exactPlant]), true);
    assert.equal(offerIsAllExactPlants([exactPlant, growersChoice]), false);
    assert.equal(offerIsAllExactPlants([]), true);
  });

  it("counts an unavailable plant as neither, whatever route it was on", () => {
    assert.equal(
      offerIsAllExactPlants([
        exactPlant,
        { availability: "not_available", fulfillmentType: "growers_choice" },
      ]),
      true,
    );
  });

  it("drops the word exact from both the urgency and the hold sentence", () => {
    assert.match(getOfferUrgencyMessage(true), /These exact plants are reserved/);
    assert.match(getOfferUrgencyMessage(false), /These plants are reserved/);
    assert.doesNotMatch(getOfferUrgencyMessage(false), /exact/i);
    assert.match(getOfferHoldMessage("Aug 26", false), /These plants are being held for you/);
  });
});

describe("admin Draft Order links", () => {
  const shop = "upt-plant-request-dev.myshopify.com";
  const gid = "gid://shopify/DraftOrder/9001";

  it("builds the Shopify Admin URL from the stored GID", () => {
    assert.equal(
      shopifyAdminDraftOrderUrl(shop, gid),
      "https://admin.shopify.com/store/upt-plant-request-dev/draft_orders/9001",
    );
  });

  it("shows a live link only when a GID exists and the draft is not voided", () => {
    assert.deepEqual(
      adminDraftOrderLinkState({ shop, shopifyDraftOrderGid: gid }),
      {
        kind: "live",
        href: "https://admin.shopify.com/store/upt-plant-request-dev/draft_orders/9001",
      },
    );
  });

  it("shows historical voided status instead of a live link", () => {
    assert.deepEqual(
      adminDraftOrderLinkState({
        shop,
        shopifyDraftOrderGid: gid,
        voidedAt: new Date("2026-08-22T12:00:00Z"),
      }),
      { kind: "voided" },
    );
  });

  it("shows nothing when no Draft Order exists", () => {
    assert.deepEqual(adminDraftOrderLinkState({ shop }), { kind: "none" });
    assert.equal(shopifyAdminDraftOrderUrl(shop, null), undefined);
  });
});

describe("the customer support note", () => {
  it("is for New and Pending only", () => {
    assert.equal(showCustomerSupportNote("New"), true);
    assert.equal(showCustomerSupportNote("Pending"), true);
    assert.equal(showCustomerSupportNote("Closed"), false);
    assert.equal(showCustomerSupportNote("Expired"), false);
    assert.equal(CUSTOMER_SUPPORT_EMAIL, "support@unsolicitedplanttalks.com");
    assert.equal(ADMIN_OVERRIDE_CLOSE_REASON, "Admin Override Close");
    assert.equal(
      INVOICE_VOIDED_BY_ADMIN_REASON,
      "Invoice voided after admin override close",
    );
  });

  it("stays hidden on a Closed or expired offer even if the stored status is still Pending", () => {
    assert.equal(
      shouldRenderCustomerSupportNote({
        status: "Pending",
        requestClosed: true,
      }),
      false,
    );
    assert.equal(
      shouldRenderCustomerSupportNote({
        status: "Pending",
        offerExpired: true,
      }),
      false,
    );
    assert.equal(
      shouldRenderCustomerSupportNote({ status: "Closed" }),
      false,
    );
  });
});

describe("the checkout URL a customer may still be shown", () => {
  const url = "https://shop.myshopify.com/invoices/abc";

  it("keeps a live unpaid invoice", () => {
    assert.equal(
      payableInvoiceUrl({
        invoiceUrl: url,
        expiresAtIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
      url,
    );
  });

  it("drops the URL once the hold ends, even before the row is marked voided", () => {
    assert.equal(
      payableInvoiceUrl({
        invoiceUrl: url,
        expiresAtIso: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
      null,
    );
  });

  it("drops the URL when the draft order has been voided", () => {
    assert.equal(
      payableInvoiceUrl({ invoiceUrl: url, voidedAt: new Date() }),
      null,
    );
  });

  it("drops the URL on a paid or closed request", () => {
    assert.equal(payableInvoiceUrl({ invoiceUrl: url, requestPaid: true }), null);
    assert.equal(payableInvoiceUrl({ invoiceUrl: url, requestClosed: true }), null);
  });
});

describe("the admin payment-link recovery button", () => {
  it("is only for a live accepted request whose invoice never landed", () => {
    assert.equal(
      shouldOfferAdminPaymentLinkRecovery({
        hasAcceptedItems: true,
        paymentLink: null,
        requestStatus: "Pending",
      }),
      true,
    );
  });

  it("stays hidden when the invoice already exists or the hold is over", () => {
    assert.equal(
      shouldOfferAdminPaymentLinkRecovery({
        hasAcceptedItems: true,
        paymentLink: "https://shop.example/pay",
        requestStatus: "Pending",
      }),
      false,
    );
    assert.equal(
      shouldOfferAdminPaymentLinkRecovery({
        hasAcceptedItems: true,
        paymentLink: null,
        requestStatus: "Expired",
      }),
      false,
    );
    assert.equal(
      shouldOfferAdminPaymentLinkRecovery({
        hasAcceptedItems: true,
        paymentLink: null,
        requestStatus: "Pending",
        invoiceVoided: true,
      }),
      false,
    );
    assert.equal(
      shouldOfferAdminPaymentLinkRecovery({
        hasAcceptedItems: true,
        paymentLink: null,
        requestStatus: "Closed",
        requestPaid: true,
      }),
      false,
    );
  });
});

describe("the payment-after-void admin email", () => {
  it("names the request and says the money was recorded", () => {
    const email = buildAdminPaymentAfterVoidEmail({
      requestNumber: "REQ9",
      orderNumber: "#1002",
    });
    assert.match(email.subject, /URGENT/);
    assert.match(email.subject, /REQ9/);
    assert.match(email.bodyText, /#1002/);
    assert.match(email.bodyText, /recorded/);
    assert.match(email.bodyText, /relisted or sold/);
    assert.equal(PAYMENT_AFTER_VOID_REASON, "Payment After Expiration/Void");
    assert.equal(INVOICE_VOIDED_REASON, "Invoice voided after expiration");
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

describe("an offer cannot be sent on an incomplete Grower's Choice item", () => {
  const linkedStock = {
    productGid: "gid://shopify/Product/1",
    productTitle: "Monstera Thai Constellation",
    variantGid: "gid://shopify/ProductVariant/1",
    variantTitle: "6 inch",
    variantPrice: 285,
    variantWeightLbs: 4.5,
    inventoryQuantity: 3,
    inventoryTracked: true,
  };
  const ready = {
    plantName: "Monstera Thai",
    offeredName: "Monstera Thai Constellation",
    availability: "available",
    fulfillmentType: "growers_choice",
    price: 285,
    weightLbs: 0,
    quantity: 1,
    photos: [],
    linkedStock,
  };

  it("needs no exact photo, because there is no one plant to photograph", () => {
    assert.deepEqual(incompleteOfferItems([ready]), []);
  });

  it("takes the weight from the linked variant when the item has none", () => {
    assert.deepEqual(
      incompleteOfferItems([
        { ...ready, linkedStock: { ...linkedStock, variantWeightLbs: 0 }, weightLbs: 3 },
      ]),
      [],
    );
  });

  it("asks for a listing before anything else when nothing is linked", () => {
    assert.deepEqual(
      incompleteOfferItems([{ ...ready, linkedStock: undefined }]),
      [
        {
          itemName: "Monstera Thai Constellation",
          missing: ["a linked store listing", "a weight"],
        },
      ],
    );
  });

  it("refuses a listing that no longer holds enough", () => {
    assert.deepEqual(
      incompleteOfferItems([
        { ...ready, quantity: 2, linkedStock: { ...linkedStock, inventoryQuantity: 1 } },
      ]),
      [
        {
          itemName: "Monstera Thai Constellation",
          missing: ["enough stock on the linked listing"],
        },
      ],
    );
  });

  it("accepts a listing Shopify does not count, which has nothing to be short of", () => {
    assert.deepEqual(
      incompleteOfferItems([
        {
          ...ready,
          linkedStock: {
            ...linkedStock,
            inventoryTracked: false,
            inventoryQuantity: undefined,
          },
        },
      ]),
      [],
    );
  });

  it("still needs a price, which is what the customer is billed", () => {
    assert.deepEqual(incompleteOfferItems([{ ...ready, price: 0 }]), [
      { itemName: "Monstera Thai Constellation", missing: ["a price"] },
    ]);
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
