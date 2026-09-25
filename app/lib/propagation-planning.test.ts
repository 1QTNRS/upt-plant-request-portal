import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalPlantKey } from "./plant-identity";
import {
  PROPAGATION_CATEGORY_DEFINITIONS,
  buildPropagationCategories,
  buildPropagationGroups,
  countNewSinceDone,
  customerIdentityKey,
  filterPropagationCategories,
  filterPropagationGroups,
  mergePlanningStateRows,
  occurrenceInDateRange,
  oldestSubmittedAtIso,
  propagationCategoryIdForReason,
  propagationGroupKeyForItem,
  sortPropagationCategoryPlants,
  sortPropagationGroups,
  summarizeReasonCounts,
  type RawPropagationOccurrence,
} from "./propagation-planning";

function occ(
  overrides: Partial<RawPropagationOccurrence> & Pick<RawPropagationOccurrence, "offerItemId">,
): RawPropagationOccurrence {
  return {
    requestId: "req",
    requestNumber: "REQ1",
    submittedAtIso: "2026-09-01T12:00:00.000Z",
    offerSentAtIso: "2026-09-02T12:00:00.000Z",
    plantName: "Hoya sp. XYZ",
    unavailableReason: "currently not in UPT prop circulation",
    customerFacingNotes: "Needs time",
    customerRequestNotes: null,
    customerKey: "email:a@example.com",
    canonicalPlantId: null,
    canonicalDisplayName: null,
    ...overrides,
  };
}

describe("propagation planning grouping", () => {
  it("groups by canonicalPlantId when present", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", plantName: "Hoya sp.", canonicalPlantId: "cp1" }),
        occ({ offerItemId: "2", plantName: "Hoya species", canonicalPlantId: "cp1" }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map([["cp1", "Hoya sp. XYZ"]]),
      planningStates: [],
      dateRange: "all",
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.groupKey, "c:cp1");
    assert.equal(groups[0]?.occurrenceCount, 2);
    assert.equal(groups[0]?.displayName, "Hoya sp. XYZ");
  });

  it("falls back to canonicalPlantKey when canonical id is absent", () => {
    const key = canonicalPlantKey("Hoya carnosa");
    const groups = buildPropagationGroups({
      occurrences: [occ({ offerItemId: "1", plantName: "Hoya carnosa" })],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    assert.equal(groups[0]?.groupKey, `a:${key}`);
  });

  it("merges alias buckets into canonical via alias map without fuzzy matching", () => {
    const alias = canonicalPlantKey("Hoya sp. XYZ");
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", plantName: "Hoya sp. XYZ" }),
        occ({ offerItemId: "2", plantName: "Other spelling", canonicalPlantId: "cp9" }),
      ],
      aliasToCanonical: new Map([[alias, "cp9"]]),
      canonicalNames: new Map([["cp9", "Hoya sp. XYZ"]]),
      planningStates: [],
      dateRange: "all",
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.occurrenceCount, 2);
  });

  it("keeps original customer wording in occurrence history", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", plantName: "HOYA sp. xyz" }),
        occ({ offerItemId: "2", plantName: "Hoya sp. XYZ" }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    const names = groups[0]?.occurrences.map((row) => row.plantName).sort();
    assert.deepEqual(names, ["HOYA sp. xyz", "Hoya sp. XYZ"]);
  });
});

describe("propagation planning counts", () => {
  it("counts unique customers and reason summaries", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({
          offerItemId: "1",
          customerKey: "email:a@example.com",
          unavailableReason: "currently not in UPT prop circulation",
        }),
        occ({
          offerItemId: "2",
          customerKey: "email:b@example.com",
          unavailableReason: "currently not in UPT prop circulation",
        }),
        occ({
          offerItemId: "3",
          customerKey: "email:a@example.com",
          unavailableReason: "available in 2+ mos",
        }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    assert.equal(groups[0]?.occurrenceCount, 3);
    assert.equal(groups[0]?.uniqueCustomerCount, 2);
    assert.deepEqual(summarizeReasonCounts(groups[0]!.occurrences), [
      { reason: "currently not in UPT prop circulation", count: 2 },
      { reason: "available in 2+ mos", count: 1 },
    ]);
  });

  it("filters occurrences by 30-day date range", () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    assert.equal(
      occurrenceInDateRange(
        { offerSentAtIso: "2026-08-20T12:00:00.000Z" },
        "30d",
        now,
      ),
      false,
    );
    assert.equal(
      occurrenceInDateRange(
        { offerSentAtIso: "2026-09-10T12:00:00.000Z" },
        "30d",
        now,
      ),
      true,
    );
  });
});

describe("propagation planning state", () => {
  it("merges alias planning state into canonical group view", () => {
    const aliasKey = propagationGroupKeyForItem({
      canonicalPlantId: null,
      plantName: "Hoya sp. XYZ",
    });
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", plantName: "Hoya sp. XYZ", canonicalPlantId: "cp1" }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map([["cp1", "Hoya sp. XYZ"]]),
      planningStates: [
        {
          groupKey: aliasKey,
          completedAt: new Date("2026-09-20T12:00:00.000Z"),
          propNotes: "Mother recovering",
          updatedAt: new Date("2026-09-21T12:00:00.000Z"),
        },
      ],
      dateRange: "all",
    });
    assert.equal(groups[0]?.state.done, true);
    assert.equal(groups[0]?.state.propNotes, "Mother recovering");
  });

  it("counts new requests after completedAt without clearing done", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", offerSentAtIso: "2026-09-01T12:00:00.000Z" }),
        occ({ offerItemId: "2", offerSentAtIso: "2026-09-22T12:00:00.000Z" }),
        occ({ offerItemId: "3", offerSentAtIso: "2026-09-23T12:00:00.000Z" }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [
        {
          groupKey: `a:${canonicalPlantKey("Hoya sp. XYZ")}`,
          completedAt: new Date("2026-09-21T12:00:00.000Z"),
          propNotes: "",
          updatedAt: new Date("2026-09-21T12:00:00.000Z"),
        },
      ],
      dateRange: "all",
    });
    assert.equal(groups[0]?.state.done, true);
    assert.equal(groups[0]?.newSinceDone, 2);
    assert.equal(
      countNewSinceDone(groups[0]!.occurrences, groups[0]!.state.completedAtIso),
      2,
    );
  });

  it("prefers canonical state row when both alias and canonical exist", () => {
    const merged = mergePlanningStateRows([
      {
        groupKey: "a:hoya sp xyz",
        completedAt: null,
        propNotes: "alias notes",
        updatedAt: new Date("2026-09-01T12:00:00.000Z"),
      },
      {
        groupKey: "c:cp1",
        completedAt: new Date("2026-09-10T12:00:00.000Z"),
        propNotes: "",
        updatedAt: new Date("2026-09-11T12:00:00.000Z"),
      },
    ]);
    assert.equal(merged.done, true);
    assert.equal(merged.propNotes, "alias notes");
  });
});

describe("propagation planning filters", () => {
  const sample = buildPropagationGroups({
    occurrences: [
      occ({ offerItemId: "1", plantName: "Hoya A" }),
      occ({ offerItemId: "2", plantName: "Philodendron B" }),
    ],
    aliasToCanonical: new Map(),
    canonicalNames: new Map(),
    planningStates: [
      {
        groupKey: `a:${canonicalPlantKey("Hoya A")}`,
        completedAt: new Date("2026-09-01T12:00:00.000Z"),
        propNotes: "",
        updatedAt: new Date("2026-09-01T12:00:00.000Z"),
      },
    ],
    dateRange: "all",
  });

  it("filters done vs needs propagation", () => {
    assert.equal(filterPropagationGroups(sample, "done", "").length, 1);
    assert.equal(filterPropagationGroups(sample, "needs", "").length, 1);
  });

  it("searches display and customer spellings", () => {
    const filtered = filterPropagationGroups(sample, "all", "philodendron");
    assert.equal(filtered.length, 1);
    assert.match(filtered[0]?.displayName ?? "", /Philodendron/i);
  });

  it("sorts most requested and A–Z", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({ offerItemId: "1", plantName: "Zz plant" }),
        occ({ offerItemId: "2", plantName: "Hoya A" }),
        occ({ offerItemId: "3", plantName: "Hoya A" }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    const byCount = sortPropagationGroups(groups, "most_requested");
    assert.equal(byCount[0]?.occurrenceCount, 2);
    const az = sortPropagationGroups(groups, "az");
    assert.ok((az[0]?.displayName ?? "") < (az[az.length - 1]?.displayName ?? ""));
  });
});

describe("customer identity key", () => {
  it("prefers shopify customer id over email", () => {
    assert.equal(
      customerIdentityKey({
        shopifyCustomerId: "gid://shopify/Customer/1",
        customerEmail: "a@example.com",
      }),
      "shopify:gid://shopify/Customer/1",
    );
  });
});

describe("propagation planning categories", () => {
  it("maps stored unavailable reasons to display categories in fixed order", () => {
    assert.equal(
      propagationCategoryIdForReason("currently not in UPT prop circulation"),
      "upt_prop_circulation",
    );
    assert.equal(propagationCategoryIdForReason("available in 2+ mos"), "available_2plus_mos");
    assert.equal(
      propagationCategoryIdForReason("not in our current inventory"),
      "upt_inventory",
    );
    assert.equal(propagationCategoryIdForReason("available in 2-3weeks"), "available_2_3_weeks");
    assert.equal(propagationCategoryIdForReason("other"), "other");
    assert.deepEqual(
      PROPAGATION_CATEGORY_DEFINITIONS.map((row) => row.id),
      [
        "upt_prop_circulation",
        "available_2plus_mos",
        "upt_inventory",
        "available_2_3_weeks",
        "other",
      ],
    );
  });

  it("groups plants under reason categories with unique customers and oldest request", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({
          offerItemId: "1",
          plantName: "Hoya XYZ",
          customerKey: "email:a@example.com",
          submittedAtIso: "2026-09-10T12:00:00.000Z",
          unavailableReason: "available in 2+ mos",
        }),
        occ({
          offerItemId: "2",
          plantName: "Hoya XYZ",
          customerKey: "email:a@example.com",
          submittedAtIso: "2026-08-12T12:00:00.000Z",
          unavailableReason: "available in 2+ mos",
        }),
        occ({
          offerItemId: "3",
          plantName: "Hoya XYZ",
          customerKey: "email:b@example.com",
          submittedAtIso: "2026-09-01T12:00:00.000Z",
          unavailableReason: "available in 2+ mos",
        }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    const categories = buildPropagationCategories(groups);
    assert.equal(categories.length, 1);
    assert.equal(categories[0]?.title, "Available in 2+ mos");
    assert.equal(categories[0]?.plants[0]?.uniqueCustomerCount, 2);
    assert.equal(categories[0]?.plants[0]?.oldestRequestAtIso, "2026-08-12T12:00:00.000Z");
    assert.equal(
      oldestSubmittedAtIso(groups[0]!.occurrences),
      "2026-08-12T12:00:00.000Z",
    );
  });

  it("omits empty categories and sorts plants within a category", () => {
    const groups = buildPropagationGroups({
      occurrences: [
        occ({
          offerItemId: "1",
          plantName: "Zz plant",
          customerKey: "email:a@example.com",
          unavailableReason: "currently not in UPT prop circulation",
        }),
        occ({
          offerItemId: "2",
          plantName: "Hoya ABC",
          customerKey: "email:a@example.com",
          unavailableReason: "currently not in UPT prop circulation",
        }),
        occ({
          offerItemId: "3",
          plantName: "Hoya ABC",
          customerKey: "email:b@example.com",
          unavailableReason: "currently not in UPT prop circulation",
        }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [],
      dateRange: "all",
    });
    const sorted = sortPropagationCategoryPlants(buildPropagationCategories(groups), "most_requested");
    assert.equal(sorted[0]?.plants[0]?.displayName, "Hoya ABC");
    assert.equal(sorted[0]?.plants[0]?.uniqueCustomerCount, 2);
  });

  it("filters plant rows by done state across categories", () => {
    const doneKey = propagationGroupKeyForItem({
      canonicalPlantId: null,
      plantName: "Hoya done",
    });
    const groups = buildPropagationGroups({
      occurrences: [
        occ({
          offerItemId: "1",
          plantName: "Hoya done",
          unavailableReason: "other",
          customerFacingNotes: "Note A",
        }),
        occ({
          offerItemId: "2",
          plantName: "Hoya open",
          unavailableReason: "available in 2+ mos",
        }),
      ],
      aliasToCanonical: new Map(),
      canonicalNames: new Map(),
      planningStates: [
        {
          groupKey: doneKey,
          completedAt: new Date("2026-09-01T12:00:00.000Z"),
          propNotes: "",
          updatedAt: new Date("2026-09-01T12:00:00.000Z"),
        },
      ],
      dateRange: "all",
    });
    const categories = buildPropagationCategories(groups);
    const needs = filterPropagationCategories(categories, "needs", "");
    assert.equal(needs.length, 1);
    assert.equal(needs[0]?.id, "available_2plus_mos");
    const done = filterPropagationCategories(categories, "done", "");
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, "other");
    assert.equal(done[0]?.plants[0]?.otherOccurrences[0]?.customerFacingNotes, "Note A");
  });
});
