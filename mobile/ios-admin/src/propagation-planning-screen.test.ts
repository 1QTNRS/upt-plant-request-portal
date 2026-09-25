import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  appendNotesDraft,
  mergeNotesDraftsFromCategories,
  normalizePropagationPlanningPayload,
} from "./propagation-planning-screen";
import type { PropagationPlanningPayload } from "./types";

function payload(
  overrides: Partial<PropagationPlanningPayload> = {},
): PropagationPlanningPayload {
  return {
    summary: { needsPropagation: 0, done: 0, unavailableInRange: 0 },
    categories: [],
    filters: { status: "needs", dateRange: "all", sort: "most_requested", q: "" },
    ...overrides,
  };
}

describe("PropagationPlanningScreen notes draft helpers", () => {
  it("merges notes when the updater receives undefined current state", () => {
    const merged = mergeNotesDraftsFromCategories(undefined, [
      {
        id: "other",
        title: "Other",
        actionLabel: "Needs Propagation",
        plants: [
          {
            groupKey: "a:hoya",
            displayName: "Hoya",
            uniqueCustomerCount: 1,
            oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
            newSinceDone: 0,
            state: {
              done: false,
              completedAtIso: null,
              propNotes: "Mother recovering",
              updatedAtIso: null,
            },
            otherOccurrences: [],
          },
        ],
      },
    ]);
    assert.equal(merged["a:hoya"], "Mother recovering");
  });

  it("preserves in-progress edits while loading new categories", () => {
    const merged = mergeNotesDraftsFromCategories(
      { "a:hoya": "Typed locally" },
      [
        {
          id: "other",
          title: "Other",
          actionLabel: "Needs Propagation",
          plants: [
            {
              groupKey: "a:hoya",
              displayName: "Hoya",
              uniqueCustomerCount: 1,
              oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
              newSinceDone: 0,
              state: {
                done: false,
                completedAtIso: null,
                propNotes: "Server text",
                updatedAtIso: null,
              },
              otherOccurrences: [],
            },
          ],
        },
      ],
    );
    assert.equal(merged["a:hoya"], "Typed locally");
  });

  it("appendNotesDraft tolerates undefined current state", () => {
    assert.deepEqual(appendNotesDraft(undefined, "a:hoya", "New note"), {
      "a:hoya": "New note",
    });
  });

  it("normalizes missing categories to an empty list and reports a warning", () => {
    const { payload: normalized, warning } = normalizePropagationPlanningPayload(
      payload({ categories: undefined as unknown as PropagationPlanningPayload["categories"] }),
    );
    assert.deepEqual(normalized.categories, []);
    assert.equal(warning.missingCategories, true);
    assert.match(warning.message ?? "", /missing categories/i);
  });

  it("normalizes missing plants arrays inside categories", () => {
    const { payload: normalized } = normalizePropagationPlanningPayload(
      payload({
        categories: [
          {
            id: "other",
            title: "Other",
            actionLabel: "Needs Propagation",
            plants: undefined as unknown as PropagationPlanningPayload["categories"][0]["plants"],
          },
        ],
      }),
    );
    assert.deepEqual(normalized.categories[0]?.plants, []);
  });
});

describe("PropagationPlanningScreen source guards", () => {
  it("uses defensive notes draft helpers in the screen", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "PropagationPlanningScreen.tsx"),
      "utf8",
    );
    assert.match(source, /mergeNotesDraftsFromCategories/);
    assert.match(source, /appendNotesDraft/);
    assert.match(source, /normalizePropagationPlanningPayload/);
    assert.match(source, /payload\?\.categories \?\? \[\]/);
  });
});
