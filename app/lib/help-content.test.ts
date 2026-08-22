import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { exactPlantReleaseReason } from "./exact-plants";
import { resolveFulfillmentType } from "./growers-choice";
import {
  GLOSSARY,
  GLOSSARY_CATEGORY_ORDER,
  glossaryEntry,
  REQUIRED_GLOSSARY_TERMS,
  type GlossaryEntry,
} from "./help-glossary";
import { helpPassages, resolveHelpQuestion } from "./help-retrieval";
import { HELP_TOPICS } from "./help-topics";
import {
  REPEATED_DECLINE_MIN_DECLINES,
  REPEATED_DECLINE_MIN_REQUESTS,
  REPEATED_DECLINE_WINDOW_DAYS,
  repeatedRequestDeclinePattern,
  type CanonicalPlantActivity,
} from "./plant-behavior";
import {
  buildDraftOrderLineItems,
  computeBehaviorFlags,
  computeNoPaymentRate,
  formatCustomerStatusLabel,
  formatRequestNumber,
  NEEDS_PAYMENT_LABEL,
  NOTHING_TO_PAY_LABEL,
  OFFER_READY_LABEL,
  offerHasPayableItems,
  percent,
  type CustomerBehaviorMetrics,
  type RequestStatus,
} from "./portal";

const repoRoot = path.join(import.meta.dirname, "..", "..");

function entryFor(term: string): GlossaryEntry {
  const needle = term.toLowerCase();
  const entry = GLOSSARY.find(
    (candidate) =>
      candidate.term.toLowerCase() === needle ||
      candidate.aliases.some((alias) => alias.toLowerCase() === needle),
  );
  assert.ok(entry, `the glossary must define ${term}`);
  return entry;
}

function bodyOf(entry: { summary: string; detail: string[] }): string {
  return [entry.summary, ...entry.detail].join(" ");
}

describe("the glossary covers the portal's vocabulary", () => {
  it("defines every required term", () => {
    for (const term of REQUIRED_GLOSSARY_TERMS) {
      const entry = entryFor(term);
      assert.ok(entry.summary.trim(), `${term} needs a one-line summary`);
      assert.ok(entry.detail.length > 0, `${term} needs a body`);
      assert.ok(entry.citations.length > 0, `${term} needs a source`);
    }
  });

  it("answers a plain question about every required term", () => {
    for (const term of REQUIRED_GLOSSARY_TERMS) {
      const resolution = resolveHelpQuestion({
        question: `What does ${term} mean?`,
      });
      assert.ok(resolution.documented, `${term} should be answerable`);
      assert.equal(
        resolution.passages[0].id,
        entryFor(term).id,
        `asking about ${term} should answer with ${term}`,
      );
    }
  });

  it("keeps ids, terms and cross-references consistent", () => {
    const passages = helpPassages();
    const ids = new Set<string>();
    for (const passage of passages) {
      assert.ok(!ids.has(passage.id), `duplicate id ${passage.id}`);
      ids.add(passage.id);
    }
    for (const passage of passages) {
      for (const related of passage.seeAlso) {
        assert.ok(ids.has(related), `${passage.id} points at unknown ${related}`);
      }
    }
    for (const entry of GLOSSARY) {
      assert.ok(
        GLOSSARY_CATEGORY_ORDER.includes(entry.category),
        `${entry.id} has an unlisted category`,
      );
    }
  });

  /**
   * The glossary is written down precisely so it can be checked. A quote that
   * has gone from the file it cites means the rule moved, and the entry
   * describing it has to be read again rather than left saying the old thing.
   */
  it("quotes wording that is still in the file it cites", async () => {
    const cache = new Map<string, string>();
    const read = async (relative: string) => {
      if (!cache.has(relative)) {
        cache.set(relative, await readFile(path.join(repoRoot, relative), "utf8"));
      }
      return cache.get(relative) as string;
    };

    let checked = 0;
    for (const entry of [...GLOSSARY, ...HELP_TOPICS]) {
      for (const citation of entry.citations) {
        const source = await read(citation.path);
        if (!citation.quote) continue;
        checked += 1;
        assert.ok(
          source.includes(citation.quote),
          `${entry.id} quotes wording no longer in ${citation.path}: ${citation.quote}`,
        );
      }
    }
    assert.ok(checked > 20, "the citations should have been found and read");
  });

  it("carries no customer data", () => {
    for (const passage of helpPassages()) {
      const text = [passage.title, bodyOf(passage)].join(" ");
      assert.ok(
        !/[\w.-]+@[\w.-]+\.\w+/.test(text),
        `${passage.id} must not contain an email address`,
      );
    }
  });
});

describe("the three derived customer labels", () => {
  const stored: RequestStatus[] = ["New", "Pending", "Closed", "Expired"];

  it("are not stored statuses", () => {
    for (const label of [OFFER_READY_LABEL, NEEDS_PAYMENT_LABEL, NOTHING_TO_PAY_LABEL]) {
      assert.ok(
        !stored.includes(label as RequestStatus),
        `${label} is a label, not a stored status`,
      );
      assert.equal(entryFor(label).category, "customer label");
      assert.match(bodyOf(entryFor(label)), /[Dd]erived/);
    }
    for (const status of stored) {
      assert.equal(entryFor(status).category, "stored status");
    }
  });

  it("come out of formatCustomerStatusLabel exactly as the glossary says", () => {
    assert.equal(formatCustomerStatusLabel("Pending"), OFFER_READY_LABEL);
    assert.equal(
      formatCustomerStatusLabel("Pending", { hasResponded: true }),
      NEEDS_PAYMENT_LABEL,
    );
    assert.equal(
      formatCustomerStatusLabel("Pending", { hasPayableItems: false }),
      NOTHING_TO_PAY_LABEL,
    );
    assert.equal(
      formatCustomerStatusLabel("Pending", {
        hasResponded: true,
        hasPayableItems: false,
      }),
      NOTHING_TO_PAY_LABEL,
      "nothing payable wins over having answered",
    );

    // Only Pending is relabelled, which is what makes the other three entries
    // able to say the status is what the customer sees.
    for (const status of ["New", "Closed", "Expired"] as const) {
      assert.equal(
        formatCustomerStatusLabel(status, { hasResponded: true }),
        status,
      );
    }
  });

  it("agrees with offerHasPayableItems about what No Payment Needed means", () => {
    assert.equal(
      offerHasPayableItems({ offerItems: [{ availability: "not_available" }] }),
      false,
      "an offer with nothing available is unpayable whatever the customer says",
    );
    assert.equal(
      offerHasPayableItems({
        offerItems: [{ availability: "available" }],
        responseChoices: ["reject"],
      }),
      false,
    );
    assert.equal(
      offerHasPayableItems({ offerItems: [{ availability: "available" }] }),
      true,
      "an unanswered offer is still payable",
    );
  });
});

describe("what expiry is and what it releases", () => {
  const offered = { hasOfferItem: true, offerAvailability: "available" };

  it("matches exactPlantReleaseReason on all three release reasons", () => {
    assert.equal(
      exactPlantReleaseReason({ ...offered, responseChoice: "reject" }),
      "customer_declined",
    );
    assert.equal(
      exactPlantReleaseReason({
        ...offered,
        requestStatus: "Expired",
        responseChoice: "accept",
      }),
      "accepted_unpaid_expired",
    );
    assert.equal(
      exactPlantReleaseReason({ ...offered, requestStatus: "Expired" }),
      "never_responded_expired",
    );

    const body = bodyOf(entryFor("Expired"));
    for (const reason of ["accepted_unpaid_expired", "never_responded_expired"]) {
      assert.ok(body.includes(reason), `the Expired entry should name ${reason}`);
    }
  });

  it("releases nothing that is still promised to someone", () => {
    assert.equal(
      exactPlantReleaseReason({
        ...offered,
        requestStatus: "Pending",
        responseChoice: "accept",
      }),
      null,
      "a live hold releases nothing",
    );
    assert.equal(
      exactPlantReleaseReason({
        ...offered,
        offerAvailability: "not_available",
        requestStatus: "Expired",
      }),
      null,
      "UPT Not Available has no exact plant to release",
    );
    assert.equal(
      exactPlantReleaseReason({
        ...offered,
        requestStatus: "Expired",
        responseChoice: "accept",
        paidAt: new Date(),
      }),
      null,
      "a sold plant stays sold",
    );
  });

  it("keeps a decline alive after the request is closed", () => {
    assert.equal(
      exactPlantReleaseReason({
        ...offered,
        responseChoice: "reject",
        requestStatus: "Closed",
      }),
      "customer_declined",
    );
    assert.match(bodyOf(entryFor("Closed")), /EXACT PLANTS queue/);
  });
});

describe("a rejected Grower's Choice plant is not a declined item", () => {
  it("is refused by the same rule that releases an exact plant", () => {
    const base = {
      hasOfferItem: true,
      offerAvailability: "available",
      responseChoice: "reject",
    };
    assert.equal(exactPlantReleaseReason(base), "customer_declined");
    assert.equal(
      exactPlantReleaseReason({ ...base, offerFulfillmentType: "growers_choice" }),
      null,
    );
    assert.match(
      bodyOf(entryFor("Grower's Choice")),
      /does not enter the EXACT PLANTS queue/,
    );
  });

  it("loses its route to Not Available, as the glossary says", () => {
    assert.equal(
      resolveFulfillmentType({
        availability: "not_available",
        fulfillmentType: "growers_choice",
      }),
      "not_available",
    );
    assert.match(bodyOf(entryFor("UPT Not Available")), /overrides/);
  });
});

describe("when FedEx is and is not relevant", () => {
  const fedex = { fedexSelected: true, fedexLabel: "FedEx", fedexPrice: 15 };

  it("is never billed without an accepted plant", () => {
    assert.deepEqual(
      buildDraftOrderLineItems({ acceptedItems: [], ...fedex }),
      [],
    );
  });

  it("is one line beside the accepted plants", () => {
    const lines = buildDraftOrderLineItems({
      acceptedItems: [
        { itemId: "item-1", plantName: "Monstera", quantity: 1, price: 200, weightLbs: 2 },
      ],
      ...fedex,
    });
    assert.equal(lines.filter((line) => line.kind === "fedex").length, 1);
    assert.equal(lines.filter((line) => line.kind === "plant").length, 1);
  });

  it("is described as a shipping service rather than a plant", () => {
    const body = bodyOf(entryFor("FedEx Priority Overnight upgrade"));
    assert.match(body, /excluded from plant revenue/);
    assert.match(body, /never given an EXACT PLANTS listing/);
  });
});

describe("the behaviour flags say what computeBehaviorFlags does", () => {
  const metrics = (
    overrides: Partial<CustomerBehaviorMetrics>,
  ): CustomerBehaviorMetrics => ({
    totalRequests: 2,
    offersSent: 2,
    itemsRequested: 2,
    itemsOffered: 2,
    itemsAccepted: 0,
    itemsPurchased: 0,
    closedPaidRequests: 0,
    expiredRequests: 0,
    totalRevenue: 0,
    ...overrides,
  });

  it("fires Approval Drop-Off only on an accepted, never-paid customer", () => {
    assert.ok(
      computeBehaviorFlags(metrics({ itemsAccepted: 2 })).includes(
        "Approval Drop-Off",
      ),
    );
    assert.ok(
      !computeBehaviorFlags(
        metrics({ itemsAccepted: 2, itemsPurchased: 1, closedPaidRequests: 1 }),
      ).includes("Approval Drop-Off"),
      "one purchase ever clears it",
    );
    assert.ok(
      !computeBehaviorFlags(metrics({ expiredRequests: 1 })).includes(
        "Approval Drop-Off",
      ),
      "never answering is Expired Offer Risk instead",
    );
    assert.ok(
      computeBehaviorFlags(metrics({ expiredRequests: 1 })).includes(
        "Expired Offer Risk",
      ),
    );
    assert.match(bodyOf(entryFor("Approval Drop-Off")), /Expired Offer Risk/);
  });

  it("fires High Request / Low Purchase at five requests and under 40%", () => {
    assert.ok(
      computeBehaviorFlags(
        metrics({ itemsRequested: 5, itemsAccepted: 1, itemsPurchased: 1 }),
      ).includes("High Request / Low Purchase"),
    );
    assert.ok(
      !computeBehaviorFlags(
        metrics({ itemsRequested: 5, itemsAccepted: 2, itemsPurchased: 2 }),
      ).includes("High Request / Low Purchase"),
      "two of five is 40%, which is not below 40%",
    );
    assert.ok(
      !computeBehaviorFlags(
        metrics({ itemsRequested: 4, itemsAccepted: 0, itemsPurchased: 0 }),
      ).includes("High Request / Low Purchase"),
      "four requests is not enough to say anything",
    );
    const body = bodyOf(entryFor("High Request / Low Purchase"));
    assert.match(body, /five/);
    assert.match(body, /40%/);
  });

  it("states the Repeated Request / Decline thresholds the code enforces", () => {
    const activity = (
      overrides: Partial<CanonicalPlantActivity> = {},
    ): CanonicalPlantActivity => ({
      canonicalPlantId: "plant-1",
      displayName: "Hoya carnosa",
      requestedNames: ["Hoya carnosa"],
      timesRequested: REPEATED_DECLINE_MIN_REQUESTS,
      timesOffered: REPEATED_DECLINE_MIN_REQUESTS,
      timesDeclined: REPEATED_DECLINE_MIN_DECLINES,
      timesPurchased: 0,
      timesExpired: 0,
      rangeDays: 30,
      mostRecentRequestAt: new Date("2026-03-01T00:00:00.000Z"),
      ...overrides,
    });

    assert.ok(repeatedRequestDeclinePattern(activity()));
    assert.equal(
      repeatedRequestDeclinePattern(
        activity({ timesRequested: REPEATED_DECLINE_MIN_REQUESTS - 1 }),
      ),
      null,
    );
    assert.equal(
      repeatedRequestDeclinePattern(
        activity({ timesDeclined: REPEATED_DECLINE_MIN_DECLINES - 1 }),
      ),
      null,
    );
    assert.equal(
      repeatedRequestDeclinePattern(activity({ timesPurchased: 1 })),
      null,
    );

    const body = bodyOf(entryFor("Repeated Request / Decline Pattern"));
    for (const threshold of [
      REPEATED_DECLINE_MIN_REQUESTS,
      REPEATED_DECLINE_MIN_DECLINES,
      REPEATED_DECLINE_WINDOW_DAYS,
    ]) {
      assert.ok(
        body.includes(String(threshold)),
        `the entry should state the threshold ${threshold}`,
      );
    }
    assert.ok(
      body.includes("canonical"),
      "counting by identity rather than typed text is the point of the flag",
    );
  });

  it("says the flags are admin-only", () => {
    for (const id of [
      "approval-drop-off",
      "high-request-low-purchase",
      "repeated-request-decline",
    ]) {
      const entry = glossaryEntry(id);
      assert.ok(entry);
      assert.equal(entry.category, "behaviour flag");
    }
    assert.match(bodyOf(entryFor("Approval Drop-Off")), /never on a customer-facing page/);
  });
});

describe("the two conversion percentages", () => {
  it("name the right numerator and denominator", () => {
    assert.match(
      bodyOf(entryFor("Accepted vs Purchased %")),
      /percent\(purchased, accepted\)/,
    );
    assert.match(
      bodyOf(entryFor("Request-to-Purchase %")),
      /percent\(purchased, requested\)/,
    );
  });

  it("describes percent() as it behaves", () => {
    assert.equal(percent(0, 0), 0, "an empty denominator is 0, not undefined");
    assert.equal(percent(1, 3), 33.3, "one decimal place");
    assert.match(bodyOf(entryFor("Accepted vs Purchased %")), /one decimal place/);
    assert.match(bodyOf(entryFor("Request-to-Purchase %")), /one decimal place/);
  });

  it("keeps No-Payment Rate separate from the No Payment Needed label", () => {
    assert.equal(computeNoPaymentRate(4, 1), 75);
    assert.equal(computeNoPaymentRate(0, 0), 0);
    assert.match(
      bodyOf(entryFor("No-Payment Rate")),
      /not the No Payment Needed label/,
    );
    assert.match(
      bodyOf(entryFor("No Payment Needed")),
      /not the No-Payment Rate/,
    );
  });
});

describe("smaller facts the glossary states", () => {
  it("numbers requests the way formatRequestNumber does", () => {
    assert.equal(formatRequestNumber(1), "REQ1");
    assert.equal(formatRequestNumber(2178), "REQ2178");
    assert.match(bodyOf(entryFor("Request number")), /no zero padding/);
  });
});
