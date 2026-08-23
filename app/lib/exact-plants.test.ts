import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildExactPlantListingDraft,
  buildExactPlantProductCreateInput,
  canDismissExactPlantFromQueue,
  countExactPlantListingFilters,
  declinedItemTag,
  EXACT_PLANT_DISMISSED_REASON,
  EXACT_PLANT_RELEASE_LABELS,
  exactPlantListingBucket,
  exactPlantReleaseTone,
  EXACT_PLANTS_COLLECTION_TITLE,
  exactPlantIneligibilityReason,
  exactPlantReleaseReason,
  isExactPlantEligible,
  isOnlineStorePublicationHandle,
  isPosPublicationHandle,
  matchesExactPlantListingFilter,
  nextExactPlantColumnSort,
  parseExactPlantListingFilter,
  parseExactPlantTableSortState,
  planExactPlantMedia,
  compareRequestNumbers,
  exactPlantEligibleAt,
  sortExactPlantTable,
} from "./exact-plants";

/** An available plant offered on a request that has not been paid. */
function offered(overrides: Record<string, unknown> = {}) {
  return {
    hasOfferItem: true,
    offerAvailability: "available",
    requestStatus: "Pending",
    ...overrides,
  };
}

describe("exact plant release eligibility", () => {
  it("releases a plant the customer declined", () => {
    assert.equal(
      exactPlantReleaseReason(offered({ responseChoice: "reject" })),
      "customer_declined",
    );
  });

  it("releases a plant the customer accepted but never paid for", () => {
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Expired" }),
      ),
      "accepted_unpaid_expired",
    );
  });

  it("releases a plant the customer never answered on an expired offer", () => {
    assert.equal(
      exactPlantReleaseReason(offered({ requestStatus: "Expired" })),
      "never_responded_expired",
    );
  });

  it("keeps holding a plant the customer accepted while the hold is live", () => {
    assert.equal(exactPlantReleaseReason(offered({ responseChoice: "accept" })), null);
  });

  it("keeps holding a plant nobody has answered while the hold is live", () => {
    assert.equal(exactPlantReleaseReason(offered()), null);
  });

  it("never releases a plant UPT marked Not Available", () => {
    for (const requestStatus of ["Pending", "Expired"]) {
      assert.equal(
        exactPlantReleaseReason({
          hasOfferItem: true,
          offerAvailability: "not_available",
          requestStatus,
          responseChoice: "unavailable",
        }),
        null,
      );
    }
  });

  it("never releases a plant that was never offered", () => {
    assert.equal(
      exactPlantReleaseReason({ hasOfferItem: false, requestStatus: "Expired" }),
      null,
    );
  });

  it("still releases a plant the customer declined on a closed request", () => {
    // An admin closing a request where the customer wanted nothing used to drop
    // exactly the plants this queue exists for. Closed means paid, or closed
    // because there was nothing to pay for; only the first is terminal.
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "reject", requestStatus: "Closed" }),
      ),
      "customer_declined",
    );
  });

  it("never releases a sold plant, however the request ended", () => {
    // Payment is what puts a plant out of scope, not the request being tidied
    // away: see "still releases a plant the customer declined" below.
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Closed", paidAt: new Date() }),
      ),
      null,
    );
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Closed" }),
      ),
      "unclaimed_after_close",
    );
    // A declined item on a request that was paid for other plants stays sold-safe.
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "reject", paidAt: new Date() }),
      ),
      null,
    );
  });

  it("never releases a declined Grower's Choice plant, which is already listed", () => {
    // It came out of stock the store already lists and went back on the shelf
    // when the hold ended. Listing it again would create a second product for a
    // plant that already has one.
    for (const responseChoice of ["reject", "accept", undefined]) {
      for (const requestStatus of ["Pending", "Expired", "Closed"]) {
        assert.equal(
          exactPlantReleaseReason(
            offered({
              offerFulfillmentType: "growers_choice",
              responseChoice,
              requestStatus,
            }),
          ),
          null,
        );
      }
    }
  });

  it("still releases a declined exact plant, however the route is spelled", () => {
    for (const offerFulfillmentType of ["exact_plant", null, undefined]) {
      assert.equal(
        exactPlantReleaseReason(
          offered({ offerFulfillmentType, responseChoice: "reject" }),
        ),
        "customer_declined",
      );
    }
  });

  it("agrees with isExactPlantEligible", () => {
    assert.equal(isExactPlantEligible(offered({ responseChoice: "reject" })), true);
    assert.equal(isExactPlantEligible(offered({ responseChoice: "accept" })), false);
  });

  it("labels every reason for the admin", () => {
    for (const reason of [
      "customer_declined",
      "accepted_unpaid_expired",
      "never_responded_expired",
      "unclaimed_after_close",
    ] as const) {
      assert.ok(EXACT_PLANT_RELEASE_LABELS[reason].length > 0);
    }
    assert.equal(EXACT_PLANT_RELEASE_LABELS.customer_declined, "Customer Declined");
    assert.equal(EXACT_PLANT_RELEASE_LABELS.unclaimed_after_close, "Unclaimed after request closed");
    assert.equal(exactPlantReleaseTone("customer_declined"), "warning");
    assert.equal(exactPlantReleaseTone("accepted_unpaid_expired"), "caution");
    assert.equal(exactPlantReleaseTone("never_responded_expired"), "info");
    assert.equal(exactPlantReleaseTone("unclaimed_after_close"), "info");
  });

  it("releases an unclaimed Exact Plant after the request is closed unpaid", () => {
    assert.equal(
      exactPlantReleaseReason(offered({ requestStatus: "Closed" })),
      "unclaimed_after_close",
    );
    assert.equal(
      exactPlantReleaseReason(
        offered({ responseChoice: "accept", requestStatus: "Closed" }),
      ),
      "unclaimed_after_close",
    );
    assert.notEqual(
      exactPlantReleaseReason(
        offered({ responseChoice: "reject", requestStatus: "Closed" }),
      ),
      "unclaimed_after_close",
      "a real decline keeps its own reason",
    );
  });
});

describe("exact plant ineligibility messages", () => {
  it("says nothing when the plant is eligible", () => {
    assert.equal(
      exactPlantIneligibilityReason(offered({ responseChoice: "reject" })),
      null,
    );
  });

  it("explains a Not Available plant", () => {
    assert.match(
      exactPlantIneligibilityReason({
        hasOfferItem: true,
        offerAvailability: "not_available",
        requestStatus: "Expired",
      }) ?? "",
      /Not Available/,
    );
  });

  it("explains a live hold", () => {
    assert.match(
      exactPlantIneligibilityReason(offered({ responseChoice: "accept" })) ?? "",
      /has not expired yet/,
    );
  });

  it("explains a paid request", () => {
    assert.match(
      exactPlantIneligibilityReason(
        offered({ responseChoice: "reject", paidAt: new Date() }),
      ) ?? "",
      /paid and closed/,
    );
  });

  it("explains that a Grower's Choice plant already has its own listing", () => {
    assert.match(
      exactPlantIneligibilityReason(
        offered({ offerFulfillmentType: "growers_choice", responseChoice: "reject" }),
      ) ?? "",
      /already has its own Shopify product/,
    );
  });

  it("explains a plant that was never offered", () => {
    assert.match(
      exactPlantIneligibilityReason({ hasOfferItem: false }) ?? "",
      /never offered/,
    );
  });
});

describe("exact plant listing filters", () => {
  const notYet = { listing: null };
  const flagged = { listing: { status: "failed" as const } };
  const listed = {
    listing: { status: "listed" as const, shopifyProductGid: "gid://shopify/Product/1" },
  };

  it("maps stored listing state onto All / Not Yet Listed / Flagged / Listed", () => {
    assert.equal(exactPlantListingBucket(notYet), "not_yet_listed");
    assert.equal(exactPlantListingBucket(flagged), "flagged");
    assert.equal(exactPlantListingBucket(listed), "listed");
    assert.equal(parseExactPlantListingFilter("listed"), "listed");
    assert.equal(parseExactPlantListingFilter("nope"), "all");
  });

  it("filters without changing the All count", () => {
    const items = [notYet, flagged, listed];
    const counts = countExactPlantListingFilters(items);
    assert.deepEqual(counts, {
      all: 3,
      not_yet_listed: 1,
      flagged: 1,
      listed: 1,
    });
    assert.equal(items.filter((item) => matchesExactPlantListingFilter(item, "all")).length, 3);
    assert.equal(
      items.filter((item) => matchesExactPlantListingFilter(item, "not_yet_listed")).length,
      1,
    );
    assert.equal(
      items.filter((item) => matchesExactPlantListingFilter(item, "flagged")).length,
      1,
    );
    assert.equal(
      items.filter((item) => matchesExactPlantListingFilter(item, "listed")).length,
      1,
    );
  });
});

describe("exact plant queue dismiss", () => {
  it("allows dismiss only for eligible plants that have not been listed", () => {
    assert.equal(EXACT_PLANT_DISMISSED_REASON, "Admin Dismissed from EXACT PLANTS");
    assert.equal(canDismissExactPlantFromQueue({}), true);
    assert.equal(
      canDismissExactPlantFromQueue({ listing: { status: "failed" } }),
      true,
    );
    assert.equal(
      canDismissExactPlantFromQueue({ dismissedAt: new Date() }),
      false,
    );
    assert.equal(
      canDismissExactPlantFromQueue({
        listing: { status: "listed", shopifyProductGid: "gid://shopify/Product/1" },
      }),
      false,
    );
    assert.equal(
      canDismissExactPlantFromQueue({
        listing: { status: "failed", shopifyProductGid: "gid://shopify/Product/1" },
      }),
      false,
    );
    assert.equal(
      canDismissExactPlantFromQueue({ listing: { status: "creating" } }),
      false,
    );
  });
});

describe("exact plant listing draft", () => {
  it("prefills title, price, weight, and photos and excludes customer/request fields", () => {
    const draft = buildExactPlantListingDraft({
      plantName: "Thai Constellation",
      offeredName: "Thai Constellation Exact",
      price: 175.4,
      weightLbs: 9.54,
      photoUrls: [
        "https://cdn.example/one.jpg",
        "https://cdn.example/two.jpg",
        "",
      ],
      customerFacingNotes: "Do not publish this disclaimer.",
      customerName: "Alex Rivera",
      customerEmail: "alex.rivera@example.com",
      requestNumber: "REQ8",
      responseChoice: "reject",
    });

    assert.deepEqual(Object.keys(draft).sort(), [
      "photoUrls",
      "price",
      "title",
      "weightLbs",
    ]);
    assert.equal(draft.title, "Thai Constellation Exact");
    assert.equal(draft.price, 175.4);
    assert.equal(draft.weightLbs, 9.5);
    assert.deepEqual(draft.photoUrls, [
      "https://cdn.example/one.jpg",
      "https://cdn.example/two.jpg",
    ]);
    assert.equal("customerFacingNotes" in draft, false);
    assert.equal(JSON.stringify(draft).includes("disclaimer"), false);
    assert.equal(JSON.stringify(draft).includes("Alex Rivera"), false);
    assert.equal(JSON.stringify(draft).includes("UPT-REQ"), false);
  });
});

describe("shopify product payload", () => {
  it("adds the product to EXACT PLANTS and omits notes from the listing", () => {
    const payload = buildExactPlantProductCreateInput({
      requestItemId: "item_123",
      title: "Thai Constellation Exact",
      photoUrls: ["https://cdn.example/one.jpg", "data:image/png;base64,abc"],
      collectionId: "gid://shopify/Collection/1",
    });

    assert.equal(payload.product.title, "Thai Constellation Exact");
    assert.deepEqual(payload.product.collectionsToJoin, [
      "gid://shopify/Collection/1",
    ]);
    assert.ok(payload.product.tags.includes(EXACT_PLANTS_COLLECTION_TITLE));
    assert.ok(payload.product.tags.includes(declinedItemTag("item_123")));
    assert.equal("descriptionHtml" in payload.product, false);
    assert.equal(JSON.stringify(payload).includes("disclaimer"), false);
    assert.deepEqual(payload.media, [
      {
        originalSource: "https://cdn.example/one.jpg",
        alt: "Thai Constellation Exact",
        mediaContentType: "IMAGE",
      },
    ]);
  });

  it("matches Online Store and POS publications only", () => {
    assert.equal(isOnlineStorePublicationHandle("online_store"), true);
    // Verbatim from a real store: Shopify reports the POS channel as `pos`.
    assert.equal(isPosPublicationHandle("pos"), true);
    assert.equal(isPosPublicationHandle("point_of_sale"), true);
    assert.equal(isOnlineStorePublicationHandle("shop"), false);
    assert.equal(isPosPublicationHandle("google_and_youtube"), false);
    assert.equal(isOnlineStorePublicationHandle("point_of_sale"), false);
    assert.equal(isPosPublicationHandle("online_store"), false);
  });

  it("does not match on the catalog title, which Shopify translates", () => {
    // With `catalogType: APP` the catalog title reads "Channel Catalog 123 for
    // Online Store" in English and is translated in other admin languages.
    assert.equal(isOnlineStorePublicationHandle("Online Store"), false);
    assert.equal(
      isOnlineStorePublicationHandle("Channel Catalog 123 for Online Store"),
      false,
    );
    assert.equal(isPosPublicationHandle("Point of Sale"), false);
  });

  it("treats a publication with no app handle as no match", () => {
    assert.equal(isOnlineStorePublicationHandle(null), false);
    assert.equal(isPosPublicationHandle(undefined), false);
    assert.equal(isOnlineStorePublicationHandle(""), false);
  });
});

describe("reconciling product media with the approved photos", () => {
  const first = "https://cdn.shopify.com/s/files/1/0/one.jpg";
  const second = "https://cdn.shopify.com/s/files/1/0/two.jpg";

  it("asks for nothing when the product already carries the approved photos", () => {
    const plan = planExactPlantMedia({
      existing: [
        { id: "gid://shopify/MediaImage/1", sourceUrl: `${first}?v=1` },
        { id: "gid://shopify/MediaImage/2", imageUrl: `${second}?v=99` },
      ],
      title: "Thai Constellation Exact",
      photoUrls: [first, second],
    });
    assert.deepEqual(plan, { create: [], detachMediaIds: [] });
  });

  it("replaces the media when the admin removed a photo", () => {
    const plan = planExactPlantMedia({
      existing: [
        { id: "gid://shopify/MediaImage/1", sourceUrl: first },
        { id: "gid://shopify/MediaImage/2", sourceUrl: second },
      ],
      title: "Thai Constellation Exact",
      photoUrls: [first],
    });
    assert.deepEqual(plan.create, [
      {
        originalSource: first,
        alt: "Thai Constellation Exact",
        mediaContentType: "IMAGE",
      },
    ]);
    assert.deepEqual(plan.detachMediaIds, [
      "gid://shopify/MediaImage/1",
      "gid://shopify/MediaImage/2",
    ]);
  });

  it("replaces the media when the admin reordered the photos", () => {
    const plan = planExactPlantMedia({
      existing: [
        { id: "gid://shopify/MediaImage/1", sourceUrl: first },
        { id: "gid://shopify/MediaImage/2", sourceUrl: second },
      ],
      title: "Thai Constellation Exact",
      photoUrls: [second, first],
    });
    assert.deepEqual(
      plan.create.map((media) => media.originalSource),
      [second, first],
      "the approved order is what the product ends up with",
    );
    assert.equal(plan.detachMediaIds.length, 2);
  });

  it("re-creates media it cannot recognize rather than leaving it published", () => {
    // Shopify serves media it created from a URL at a fresh address, so an
    // unmatched photo is the normal case and must not be mistaken for approved.
    const plan = planExactPlantMedia({
      existing: [{ id: "gid://shopify/MediaImage/9", imageUrl: null }],
      title: "Thai Constellation Exact",
      photoUrls: [first],
    });
    assert.equal(plan.create.length, 1);
    assert.deepEqual(plan.detachMediaIds, ["gid://shopify/MediaImage/9"]);
  });

  it("strips every photo when the admin approved none", () => {
    const plan = planExactPlantMedia({
      existing: [{ id: "gid://shopify/MediaImage/1", sourceUrl: first }],
      title: "Thai Constellation Exact",
      photoUrls: [],
    });
    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.detachMediaIds, ["gid://shopify/MediaImage/1"]);
  });

  it("ignores a photo Shopify could never fetch", () => {
    const plan = planExactPlantMedia({
      existing: [],
      title: "Thai Constellation Exact",
      photoUrls: ["data:image/png;base64,AAAA"],
    });
    assert.deepEqual(plan, { create: [], detachMediaIds: [] });
  });
});

describe("the EXACT PLANTS queue page", () => {
  const queue = readFileSync(
    path.join(import.meta.dirname, "..", "..", "app", "routes", "app.exact-plants._index.tsx"),
    "utf8",
  );
  const table = readFileSync(
    path.join(import.meta.dirname, "..", "..", "app", "components", "exact-plants-table.tsx"),
    "utf8",
  );
  const requestPage = readFileSync(
    path.join(import.meta.dirname, "..", "..", "app", "routes", "app.requests.$id.tsx"),
    "utf8",
  );

  it("links each plant to its originating admin request without customer PII", () => {
    assert.match(table, /\{item\.requestNumber\}/);
    assert.ok(!table.includes("Request {item.requestNumber}"));
    assert.ok(table.includes("href={`/app/requests/${item.requestId}`}"));
    assert.ok(!queue.includes("customerEmail"));
    assert.ok(!queue.includes("customerName"));
    assert.ok(!table.includes("customerEmail"));
    assert.ok(!table.includes("customerName"));
  });

  it("filters All / Not Yet Listed / Flagged / Listed via the listing query", () => {
    assert.match(queue, /parseExactPlantListingFilter/);
    assert.match(queue, /name="listing"/);
    assert.match(queue, /EXACT_PLANT_LISTING_FILTER_LABELS/);
    assert.match(queue, /EXACT_PLANT_LISTING_FILTERS/);
  });

  it("renders a sortable table and keeps filter+sort in the URL", () => {
    assert.match(queue, /ExactPlantsTable/);
    assert.match(queue, /parseExactPlantTableSortState/);
    assert.match(table, /data-exact-plants-table/);
    assert.match(table, /data-exact-plant-sort/);
    assert.match(table, />Create listing</);
    assert.ok(!table.includes("Create EXACT PLANTS Listing"));
    assert.match(table, /Dismiss from EXACT PLANTS/);
    assert.match(table, /AdminPhotoLightbox/);
    assert.match(table, /formatDate\(/);
    assert.ok(!table.includes("formatDateTime"));
    assert.match(table, /exact-plants-row-alt/);
    assert.match(table, /overflow-wrap: break-word/);
  });

  it("collapses Emails and EXACT PLANTS without remounting children", () => {
    const collapsible = readFileSync(
      path.join(import.meta.dirname, "..", "..", "app", "components", "collapsible-section.tsx"),
      "utf8",
    );
    assert.match(collapsible, /onToggle=/);
    assert.match(collapsible, /useState\(defaultOpen\)/);
    assert.match(requestPage, /title="Emails"/);
    assert.match(requestPage, /title="EXACT PLANTS"/);
    assert.match(queue, /title="EXACT PLANTS queue"/);
  });
});

describe("EXACT PLANTS table sorting", () => {
  const rows = [
    {
      requestItemId: "a",
      title: "zz plant",
      requestNumber: "REQ10",
      releaseReason: "unclaimed_after_close" as const,
      eligibleAt: "2026-01-01T00:00:00.000Z",
      price: 90,
      listing: { status: "listed" as const, shopifyProductGid: "gid://shopify/Product/1" },
    },
    {
      requestItemId: "b",
      title: "Albo",
      requestNumber: "REQ2",
      releaseReason: "customer_declined" as const,
      eligibleAt: "2026-08-01T00:00:00.000Z",
      price: 20,
      listing: { status: "failed" as const },
    },
    {
      requestItemId: "c",
      title: "Monstera",
      requestNumber: "REQ3",
      releaseReason: "accepted_unpaid_expired" as const,
      eligibleAt: "2026-04-01T00:00:00.000Z",
      price: 50,
      listing: null,
    },
  ];

  it("defaults to date oldest-first and toggles a column on repeated clicks", () => {
    const search = new URLSearchParams();
    assert.deepEqual(parseExactPlantTableSortState(search), {
      column: "date",
      direction: "asc",
    });
    const first = nextExactPlantColumnSort(
      { column: "date", direction: "asc" },
      "name",
    );
    assert.deepEqual(first, { column: "name", direction: "asc" });
    assert.deepEqual(nextExactPlantColumnSort(first, "name"), {
      column: "name",
      direction: "desc",
    });
  });

  it("sorts plant name case-insensitively", () => {
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "name", direction: "asc" }).map(
        (row) => row.title,
      ),
      ["Albo", "Monstera", "zz plant"],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "name", direction: "desc" }).map(
        (row) => row.title,
      ),
      ["zz plant", "Monstera", "Albo"],
    );
  });

  it("sorts request numbers naturally, not as raw strings", () => {
    assert.ok(compareRequestNumbers("REQ2", "REQ10") < 0);
    assert.ok(compareRequestNumbers("REQ10", "REQ2") > 0);
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "request", direction: "asc" }).map(
        (row) => row.requestNumber,
      ),
      ["REQ2", "REQ3", "REQ10"],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "request", direction: "desc" }).map(
        (row) => row.requestNumber,
      ),
      ["REQ10", "REQ3", "REQ2"],
    );
  });

  it("sorts eligibility, listing status, price, and date by the right type", () => {
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "reason", direction: "asc" }).map(
        (row) => row.releaseReason,
      ),
      ["accepted_unpaid_expired", "customer_declined", "unclaimed_after_close"],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "listing", direction: "asc" }).map(
        (row) => row.requestItemId,
      ),
      ["b", "a", "c"],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "price", direction: "asc" }).map(
        (row) => row.price,
      ),
      [20, 50, 90],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "price", direction: "desc" }).map(
        (row) => row.price,
      ),
      [90, 50, 20],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "date", direction: "asc" }).map(
        (row) => row.requestItemId,
      ),
      ["a", "c", "b"],
    );
    assert.deepEqual(
      sortExactPlantTable(rows, { column: "date", direction: "desc" }).map(
        (row) => row.requestItemId,
      ),
      ["b", "c", "a"],
    );
    assert.equal(
      exactPlantEligibleAt({
        releaseReason: "customer_declined",
        respondedAt: "2026-04-01T00:00:00.000Z",
      }),
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("keeps listing filter and sort independent", () => {
    const flagged = rows.filter((row) =>
      matchesExactPlantListingFilter(row, "flagged"),
    );
    assert.deepEqual(
      sortExactPlantTable(flagged, { column: "price", direction: "asc" }).map(
        (row) => row.requestItemId,
      ),
      ["b"],
    );
  });
});
