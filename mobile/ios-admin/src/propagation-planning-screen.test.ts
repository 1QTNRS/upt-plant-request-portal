import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  appendNotesDraft,
  mergeNotesDraftsFromTabs,
  normalizePropagationPlanningPayload,
  plantsForTab,
  PROPAGATION_TAB_ORDER,
} from "./propagation-planning-screen";
import type { PropagationPlanningPayload } from "./types";

function payload(
  overrides: Partial<PropagationPlanningPayload> = {},
): PropagationPlanningPayload {
  return {
    summary: { active: 0, done: 0, closed: 0, unavailableInRange: 0 },
    tabs: [],
    filters: { status: "active", dateRange: "all", sort: "most_requested", q: "" },
    ...overrides,
  };
}

describe("PropagationPlanningScreen notes draft helpers", () => {
  it("merges notes when the updater receives undefined current state", () => {
    const merged = mergeNotesDraftsFromTabs(undefined, [
      {
        id: "other",
        title: "Other",
        actionLabel: null,
        plants: [
          {
            groupKey: "a:hoya",
            displayName: "Hoya",
            uniqueCustomerCount: 1,
            oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
            newSinceDone: 0,
            newSinceClosed: 0,
            state: {
              done: false,
              closed: false,
              completedAtIso: null,
              closedAtIso: null,
              propNotes: "Mother recovering",
              updatedAtIso: null,
            },
            historyOccurrences: [],
            otherOccurrences: [],
          },
        ],
      },
    ]);
    assert.equal(merged["a:hoya"], "Mother recovering");
  });

  it("preserves in-progress edits while loading new tabs", () => {
    const merged = mergeNotesDraftsFromTabs(
      { "a:hoya": "Typed locally" },
      [
        {
          id: "other",
          title: "Other",
          actionLabel: null,
          plants: [
            {
              groupKey: "a:hoya",
              displayName: "Hoya",
              uniqueCustomerCount: 1,
              oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
              newSinceDone: 0,
              newSinceClosed: 0,
              state: {
                done: false,
                closed: false,
                completedAtIso: null,
                closedAtIso: null,
                propNotes: "Server text",
                updatedAtIso: null,
              },
              historyOccurrences: [],
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

  it("normalizes missing tabs and merges legacy prop categories", () => {
    const { payload: normalized, warning } = normalizePropagationPlanningPayload(
      payload({
        tabs: undefined as unknown as PropagationPlanningPayload["tabs"],
        categories: [
          {
            id: "upt_prop_circulation",
            title: "Currently not in UPT prop circulation",
            actionLabel: "Needs Propagation",
            plants: [
              {
                groupKey: "a:hoya",
                displayName: "Hoya",
                uniqueCustomerCount: 1,
                oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
                newSinceDone: 0,
                newSinceClosed: 0,
                state: {
                  done: false,
                  closed: false,
                  completedAtIso: null,
                  closedAtIso: null,
                  propNotes: "",
                  updatedAtIso: null,
                },
                historyOccurrences: [],
                otherOccurrences: [],
              },
            ],
          },
          {
            id: "available_2plus_mos",
            title: "Available in 2+ mos",
            actionLabel: "Needs Propagation",
            plants: [
              {
                groupKey: "a:phil",
                displayName: "Phil",
                uniqueCustomerCount: 1,
                oldestRequestAtIso: "2026-08-02T00:00:00.000Z",
                newSinceDone: 0,
                newSinceClosed: 0,
                state: {
                  done: false,
                  closed: false,
                  completedAtIso: null,
                  closedAtIso: null,
                  propNotes: "",
                  updatedAtIso: null,
                },
                historyOccurrences: [],
                otherOccurrences: [],
              },
            ],
          },
        ],
      }),
    );
    assert.equal(warning.missingTabs, true);
    assert.equal(normalized.tabs.length, 1);
    assert.equal(normalized.tabs[0]?.id, "prop");
    assert.equal(normalized.tabs[0]?.plants.length, 2);
  });

  it("returns plants for the selected reason tab", () => {
    const tabs = payload({
      tabs: [
        {
          id: "prop",
          title: "Prop",
          actionLabel: "Prop",
          plants: [
            {
              groupKey: "a:1",
              displayName: "One",
              uniqueCustomerCount: 1,
              oldestRequestAtIso: "2026-08-01T00:00:00.000Z",
              newSinceDone: 0,
              newSinceClosed: 0,
              state: {
                done: false,
                closed: false,
                completedAtIso: null,
                closedAtIso: null,
                propNotes: "",
                updatedAtIso: null,
              },
              historyOccurrences: [],
              otherOccurrences: [],
            },
          ],
        },
      ],
    }).tabs;
    assert.deepEqual(PROPAGATION_TAB_ORDER, ["prop", "inventory", "check_props", "other"]);
    assert.equal(plantsForTab(tabs, "prop").length, 1);
    assert.equal(plantsForTab(tabs, "inventory").length, 0);
  });
});

describe("PropagationPlanningScreen source guards", () => {
  it("uses compact filters, reason tabs, close action, and scroll-to-top", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "PropagationPlanningScreen.tsx"),
      "utf8",
    );
    assert.match(source, /mergeNotesDraftsFromTabs/);
    assert.match(source, /CompactSelect/);
    assert.match(source, /PROPAGATION_TAB_ORDER/);
    assert.match(source, /scrollToTopButtonVisible/);
    assert.match(source, /↑ Top/);
    assert.match(source, /intent: closed \? "reopen" : "close"/);
    assert.match(source, /expandedDismiss/);
    assert.match(source, /No customer-facing notes\./);
    assert.doesNotMatch(source, /categoryBox/);
  });
});
