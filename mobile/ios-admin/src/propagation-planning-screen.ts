import type {
  PropagationPlanningCategory,
  PropagationPlanningPayload,
  PropagationPlanningTab,
  PropagationTabId,
} from "./types";

export type PropagationPlanningPayloadWarning = {
  missingTabs: boolean;
  message: string | null;
};

export const PROPAGATION_TAB_ORDER: PropagationTabId[] = [
  "prop",
  "inventory",
  "check_props",
  "other",
];

const LEGACY_CATEGORY_TO_TAB: Record<string, PropagationTabId> = {
  upt_prop_circulation: "prop",
  available_2plus_mos: "prop",
  upt_inventory: "inventory",
  available_2_3_weeks: "check_props",
  other: "other",
};

function mergeTabsFromLegacyCategories(
  categories: PropagationPlanningCategory[],
): PropagationPlanningTab[] {
  const byTab = new Map<PropagationTabId, PropagationPlanningTab>();

  for (const category of categories) {
    const tabId = LEGACY_CATEGORY_TO_TAB[category.id] ?? "other";
    const existing = byTab.get(tabId);
    const plants = Array.isArray(category.plants) ? category.plants : [];
    if (!existing) {
      byTab.set(tabId, {
        id: tabId,
        title:
          tabId === "prop"
            ? "Prop"
            : tabId === "inventory"
              ? "Inventory"
              : tabId === "check_props"
                ? "Check Props"
                : "Other",
        actionLabel:
          tabId === "prop"
            ? "Prop"
            : tabId === "inventory"
              ? "Obtained"
              : tabId === "check_props"
                ? "Check Props"
                : null,
        plants: [...plants],
      });
      continue;
    }
    const seen = new Set(existing.plants.map((row) => row.groupKey));
    for (const plant of plants) {
      if (seen.has(plant.groupKey)) continue;
      existing.plants.push(plant);
      seen.add(plant.groupKey);
    }
  }

  return PROPAGATION_TAB_ORDER.map((id) => byTab.get(id)).filter(
    (tab): tab is PropagationPlanningTab => tab != null && tab.plants.length > 0,
  );
}

export function normalizePropagationPlanningPayload(
  raw: PropagationPlanningPayload,
): { payload: PropagationPlanningPayload; warning: PropagationPlanningPayloadWarning } {
  const missingTabs = !Array.isArray(raw.tabs);
  let tabs: PropagationPlanningTab[] = missingTabs
    ? mergeTabsFromLegacyCategories(
        Array.isArray(raw.categories) ? raw.categories : [],
      )
    : raw.tabs.map((tab) => ({
        ...tab,
        plants: Array.isArray(tab.plants) ? tab.plants : [],
        actionLabel: tab.actionLabel ?? null,
      }));

  if (missingTabs && Array.isArray(raw.categories) && raw.categories.length === 0) {
    tabs = [];
  }

  const summary = raw.summary ?? {
    active: 0,
    done: 0,
    closed: 0,
    unavailableInRange: 0,
  };

  return {
    payload: {
      ...raw,
      summary: {
        active: summary.active ?? (summary as { needsPropagation?: number }).needsPropagation ?? 0,
        done: summary.done ?? 0,
        closed: summary.closed ?? 0,
        unavailableInRange: summary.unavailableInRange ?? 0,
      },
      tabs,
    },
    warning: {
      missingTabs,
      message: missingTabs
        ? "Propagation planning API response is missing tabs[]; merged legacy categories when present."
        : null,
    },
  };
}

export function mergeNotesDraftsFromTabs(
  current: Record<string, string> | undefined,
  tabs: PropagationPlanningTab[],
): Record<string, string> {
  const merged = { ...(current ?? {}) };
  for (const tab of tabs) {
    for (const plant of tab.plants) {
      if (merged[plant.groupKey] === undefined) {
        merged[plant.groupKey] = plant.state?.propNotes ?? "";
      }
    }
  }
  return merged;
}

/** @deprecated Use mergeNotesDraftsFromTabs */
export function mergeNotesDraftsFromCategories(
  current: Record<string, string> | undefined,
  categories: PropagationPlanningCategory[],
): Record<string, string> {
  return mergeNotesDraftsFromTabs(current, mergeTabsFromLegacyCategories(categories));
}

export function appendNotesDraft(
  current: Record<string, string> | undefined,
  groupKey: string,
  value: string,
): Record<string, string> {
  return {
    ...(current ?? {}),
    [groupKey]: value,
  };
}

export function plantsForTab(
  tabs: PropagationPlanningTab[],
  tabId: PropagationTabId,
): PropagationPlanningTab["plants"] {
  return tabs.find((tab) => tab.id === tabId)?.plants ?? [];
}
