import { canonicalPlantKey } from "./plant-identity";
import { normalizeUnavailableReason, type UnavailableReason } from "./portal";

export type PropagationDateRange = "all" | "90d" | "30d";

export type PropagationStatusFilter = "active" | "done" | "closed" | "all";

/** @deprecated Accept legacy mobile query values until all clients send `active`. */
export type PropagationStatusFilterLegacy = PropagationStatusFilter | "needs";

export type PropagationTabId = "prop" | "inventory" | "check_props" | "other";

export type PropagationTabDefinition = {
  id: PropagationTabId;
  title: string;
  actionLabel: string | null;
};

export const PROPAGATION_TAB_DEFINITIONS: PropagationTabDefinition[] = [
  { id: "prop", title: "Prop", actionLabel: "Prop" },
  { id: "inventory", title: "Inventory", actionLabel: "Obtained" },
  { id: "check_props", title: "Check Props", actionLabel: "Check Props" },
  { id: "other", title: "Other", actionLabel: null },
];

export type PropagationSort = "most_requested" | "oldest_request" | "az";

export type PropagationCategoryId =
  | "upt_prop_circulation"
  | "available_2plus_mos"
  | "upt_inventory"
  | "available_2_3_weeks"
  | "other";

export type PropagationCategoryDefinition = {
  id: PropagationCategoryId;
  title: string;
  actionLabel: string;
};

export const PROPAGATION_CATEGORY_DEFINITIONS: PropagationCategoryDefinition[] = [
  {
    id: "upt_prop_circulation",
    title: "Currently not in UPT prop circulation",
    actionLabel: "Needs Propagation",
  },
  {
    id: "available_2plus_mos",
    title: "Available in 2+ mos",
    actionLabel: "Needs Propagation",
  },
  {
    id: "upt_inventory",
    title: "Currently not in UPT inventory",
    actionLabel: "Obtained",
  },
  {
    id: "available_2_3_weeks",
    title: "Available in 2-3 weeks",
    actionLabel: "Check Props",
  },
  {
    id: "other",
    title: "Other",
    actionLabel: "Needs Propagation",
  },
];

export type PropagationCategoryOtherOccurrence = {
  offerItemId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  customerFacingNotes: string;
};

export type PropagationHistoryOccurrence = {
  offerItemId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  unavailableReason: string;
  customerFacingNotes: string;
};

export type PropagationCategoryPlantRow = {
  groupKey: string;
  displayName: string;
  uniqueCustomerCount: number;
  oldestRequestAtIso: string;
  newSinceDone: number;
  newSinceClosed: number;
  state: PropagationPlanningStateView;
  historyOccurrences: PropagationHistoryOccurrence[];
  otherOccurrences: PropagationCategoryOtherOccurrence[];
};

export type PropagationPlanningTab = {
  id: PropagationTabId;
  title: string;
  actionLabel: string | null;
  plants: PropagationCategoryPlantRow[];
};

export type PropagationPlanningCategory = {
  id: PropagationCategoryId;
  title: string;
  actionLabel: string;
  plants: PropagationCategoryPlantRow[];
};

export type PropagationPlanningOccurrence = {
  offerItemId: string;
  requestId: string;
  requestNumber: string;
  submittedAtIso: string;
  offerSentAtIso: string;
  plantName: string;
  unavailableReason: string | null;
  customerFacingNotes: string;
  customerRequestNotes: string | null;
  customerKey: string;
};

export type PropagationPlanningStateView = {
  done: boolean;
  closed: boolean;
  completedAtIso: string | null;
  closedAtIso: string | null;
  propNotes: string;
  updatedAtIso: string | null;
};

export type PropagationPlanningGroup = {
  groupKey: string;
  displayName: string;
  occurrenceCount: number;
  uniqueCustomerCount: number;
  lastRequestedAtIso: string;
  reasonCounts: Array<{ reason: string; count: number }>;
  newSinceDone: number;
  newSinceClosed: number;
  state: PropagationPlanningStateView;
  occurrences: PropagationPlanningOccurrence[];
};

export type PropagationPlanningSummary = {
  active: number;
  done: number;
  closed: number;
  unavailableInRange: number;
};

function stripRawOccurrenceFields(
  row: RawPropagationOccurrence,
): PropagationPlanningOccurrence {
  return {
    offerItemId: row.offerItemId,
    requestId: row.requestId,
    requestNumber: row.requestNumber,
    submittedAtIso: row.submittedAtIso,
    offerSentAtIso: row.offerSentAtIso,
    plantName: row.plantName,
    unavailableReason: row.unavailableReason,
    customerFacingNotes: row.customerFacingNotes,
    customerRequestNotes: row.customerRequestNotes,
    customerKey: row.customerKey,
  };
}

export function propagationGroupKeyForItem(input: {
  canonicalPlantId: string | null;
  plantName: string;
}): string {
  if (input.canonicalPlantId) return `c:${input.canonicalPlantId}`;
  return `a:${canonicalPlantKey(input.plantName)}`;
}

export function parsePropagationGroupKey(groupKey: string): {
  kind: "canonical" | "alias";
  id: string;
} | null {
  if (groupKey.startsWith("c:")) {
    return { kind: "canonical", id: groupKey.slice(2) };
  }
  if (groupKey.startsWith("a:")) {
    return { kind: "alias", id: groupKey.slice(2) };
  }
  return null;
}

export function customerIdentityKey(input: {
  shopifyCustomerId: string | null;
  customerEmail: string;
}): string {
  const shopify = input.shopifyCustomerId?.trim();
  if (shopify) return `shopify:${shopify}`;
  return `email:${input.customerEmail.trim().toLowerCase()}`;
}

export function dateRangeCutoff(
  range: PropagationDateRange,
  now: Date = new Date(),
): Date | null {
  if (range === "all") return null;
  const days = range === "90d" ? 90 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function occurrenceInDateRange(
  occurrence: Pick<PropagationPlanningOccurrence, "offerSentAtIso">,
  range: PropagationDateRange,
  now: Date = new Date(),
): boolean {
  const cutoff = dateRangeCutoff(range, now);
  if (!cutoff) return true;
  const sent = new Date(occurrence.offerSentAtIso);
  return Number.isFinite(sent.getTime()) && sent >= cutoff;
}

export type PropagationPlanningStateRow = {
  groupKey: string;
  completedAt: Date | null;
  closedAt: Date | null;
  propNotes: string;
  updatedAt: Date;
};

export function normalizePropagationStatusFilter(
  value: string | null | undefined,
): PropagationStatusFilter {
  if (value === "done" || value === "closed" || value === "all") return value;
  if (value === "needs" || value === "active") return "active";
  return "active";
}

export function propagationPlantMatchesStatus(
  state: PropagationPlanningStateView,
  status: PropagationStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "closed") return state.closed;
  if (status === "done") return !state.closed && state.done;
  return !state.closed && !state.done;
}

export function mergePlanningStateRows(
  rows: PropagationPlanningStateRow[],
): PropagationPlanningStateView {
  if (rows.length === 0) {
    return {
      done: false,
      closed: false,
      completedAtIso: null,
      closedAtIso: null,
      propNotes: "",
      updatedAtIso: null,
    };
  }
  const sorted = [...rows].sort((left, right) => {
    const leftCanonical = left.groupKey.startsWith("c:") ? 0 : 1;
    const rightCanonical = right.groupKey.startsWith("c:") ? 0 : 1;
    if (leftCanonical !== rightCanonical) return leftCanonical - rightCanonical;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
  const primary = sorted[0];
  const completedAt =
    sorted.find((row) => row.completedAt)?.completedAt ?? primary.completedAt;
  const closedAt =
    sorted.find((row) => row.closedAt)?.closedAt ?? primary.closedAt ?? null;
  const propNotes = sorted.find((row) => row.propNotes.trim())?.propNotes ?? primary.propNotes;
  return {
    done: completedAt != null,
    closed: closedAt != null,
    completedAtIso: completedAt?.toISOString() ?? null,
    closedAtIso: closedAt?.toISOString() ?? null,
    propNotes,
    updatedAtIso: primary.updatedAt.toISOString(),
  };
}

export function countNewSinceDone(
  occurrences: PropagationPlanningOccurrence[],
  completedAtIso: string | null,
): number {
  if (!completedAtIso) return 0;
  const completedAt = new Date(completedAtIso);
  if (!Number.isFinite(completedAt.getTime())) return 0;
  return occurrences.filter((row) => {
    const sent = new Date(row.offerSentAtIso);
    return Number.isFinite(sent.getTime()) && sent > completedAt;
  }).length;
}

export function countNewSinceClosed(
  occurrences: PropagationPlanningOccurrence[],
  closedAtIso: string | null,
): number {
  if (!closedAtIso) return 0;
  const closedAt = new Date(closedAtIso);
  if (!Number.isFinite(closedAt.getTime())) return 0;
  return occurrences.filter((row) => {
    const sent = new Date(row.offerSentAtIso);
    return Number.isFinite(sent.getTime()) && sent > closedAt;
  }).length;
}

export function summarizeReasonCounts(
  occurrences: PropagationPlanningOccurrence[],
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of occurrences) {
    const reason = (row.unavailableReason || "not in our current inventory").trim();
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

export type RawPropagationOccurrence = PropagationPlanningOccurrence & {
  canonicalPlantId: string | null;
  canonicalDisplayName: string | null;
};

export function buildPropagationGroups(input: {
  occurrences: RawPropagationOccurrence[];
  aliasToCanonical: Map<string, string>;
  canonicalNames: Map<string, string>;
  planningStates: PropagationPlanningStateRow[];
  dateRange: PropagationDateRange;
  now?: Date;
}): PropagationPlanningGroup[] {
  const buckets = new Map<string, RawPropagationOccurrence[]>();

  function mergeBucket(into: string, from: string) {
    if (into === from || !buckets.has(from)) return;
    const target = buckets.get(into) ?? [];
    target.push(...(buckets.get(from) ?? []));
    buckets.set(into, target);
    buckets.delete(from);
  }

  for (const row of input.occurrences) {
    let key = propagationGroupKeyForItem({
      canonicalPlantId: row.canonicalPlantId,
      plantName: row.plantName,
    });
    if (key.startsWith("a:")) {
      const aliasKey = key.slice(2);
      const canonicalId = input.aliasToCanonical.get(aliasKey);
      if (canonicalId) key = `c:${canonicalId}`;
    }
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  for (const [aliasKey, canonicalId] of input.aliasToCanonical.entries()) {
    mergeBucket(`c:${canonicalId}`, `a:${aliasKey}`);
  }

  const statesByKey = new Map<string, PropagationPlanningStateRow[]>();
  for (const row of input.planningStates) {
    const list = statesByKey.get(row.groupKey) ?? [];
    list.push(row);
    statesByKey.set(row.groupKey, list);
  }

  const groups: PropagationPlanningGroup[] = [];
  for (const [groupKey, rows] of buckets.entries()) {
    const inRange = rows.filter((row) =>
      occurrenceInDateRange(row, input.dateRange, input.now),
    );
    if (inRange.length === 0) continue;

    const sorted = [...inRange].sort(
      (left, right) =>
        new Date(right.offerSentAtIso).getTime() -
        new Date(left.offerSentAtIso).getTime(),
    );
    const customers = new Set(inRange.map((row) => row.customerKey));
    const parsed = parsePropagationGroupKey(groupKey);
    const displayName =
      parsed?.kind === "canonical"
        ? input.canonicalNames.get(parsed.id) ??
          sorted[0]?.canonicalDisplayName ??
          sorted[0]?.plantName ??
          groupKey
        : sorted[0]?.plantName ?? groupKey;

    const relatedStateKeys = new Set<string>([groupKey]);
    if (parsed?.kind === "canonical") {
      for (const row of rows) {
        relatedStateKeys.add(
          propagationGroupKeyForItem({
            canonicalPlantId: null,
            plantName: row.plantName,
          }),
        );
      }
      for (const [aliasKey, canonicalId] of input.aliasToCanonical.entries()) {
        if (canonicalId === parsed.id) {
          relatedStateKeys.add(`a:${aliasKey}`);
        }
      }
    }

    const mergedStates = [...relatedStateKeys].flatMap(
      (key) => statesByKey.get(key) ?? [],
    );
    const state = mergePlanningStateRows(mergedStates);
    const allOccurrences = rows.map(stripRawOccurrenceFields);

    groups.push({
      groupKey,
      displayName,
      occurrenceCount: inRange.length,
      uniqueCustomerCount: customers.size,
      lastRequestedAtIso: sorted[0]?.offerSentAtIso ?? sorted[0]?.submittedAtIso ?? "",
      reasonCounts: summarizeReasonCounts(inRange),
      newSinceDone: countNewSinceDone(allOccurrences, state.completedAtIso),
      newSinceClosed: countNewSinceClosed(allOccurrences, state.closedAtIso),
      state,
      occurrences: sorted.map(stripRawOccurrenceFields),
    });
  }

  return groups;
}

export function filterPropagationGroups(
  groups: PropagationPlanningGroup[],
  status: PropagationStatusFilter,
  query: string,
): PropagationPlanningGroup[] {
  const normalized = query.trim().toLowerCase();
  return groups.filter((group) => {
    if (!propagationPlantMatchesStatus(group.state, status)) return false;
    if (!normalized) return true;
    if (group.displayName.toLowerCase().includes(normalized)) return true;
    return group.occurrences.some((row) =>
      row.plantName.toLowerCase().includes(normalized),
    );
  });
}

export function sortPropagationGroups(
  groups: PropagationPlanningGroup[],
  sort: PropagationSort,
): PropagationPlanningGroup[] {
  const copy = [...groups];
  copy.sort((left, right) => {
    if (sort === "most_requested") {
      return (
        right.occurrenceCount - left.occurrenceCount ||
        right.lastRequestedAtIso.localeCompare(left.lastRequestedAtIso)
      );
    }
    if (sort === "oldest_request") {
      return left.lastRequestedAtIso.localeCompare(right.lastRequestedAtIso);
    }
    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    });
  });
  return copy;
}

export function summarizePropagationPlanning(
  groups: PropagationPlanningGroup[],
  dateRange: PropagationDateRange,
  allOccurrenceCountInRange: number,
): PropagationPlanningSummary {
  return {
    active: groups.filter((group) =>
      propagationPlantMatchesStatus(group.state, "active"),
    ).length,
    done: groups.filter((group) => propagationPlantMatchesStatus(group.state, "done"))
      .length,
    closed: groups.filter((group) => propagationPlantMatchesStatus(group.state, "closed"))
      .length,
    unavailableInRange: allOccurrenceCountInRange,
  };
}

export function propagationCategoryIdForReason(
  reason: string | null | undefined,
): PropagationCategoryId {
  const normalized = normalizeUnavailableReason(reason);
  const map: Record<UnavailableReason, PropagationCategoryId> = {
    "currently not in UPT prop circulation": "upt_prop_circulation",
    "available in 2+ mos": "available_2plus_mos",
    "not in our current inventory": "upt_inventory",
    "available in 2-3weeks": "available_2_3_weeks",
    other: "other",
  };
  return map[normalized];
}

export function propagationTabIdForReason(
  reason: string | null | undefined,
): PropagationTabId {
  const categoryId = propagationCategoryIdForReason(reason);
  const map: Record<PropagationCategoryId, PropagationTabId> = {
    upt_prop_circulation: "prop",
    available_2plus_mos: "prop",
    upt_inventory: "inventory",
    available_2_3_weeks: "check_props",
    other: "other",
  };
  return map[categoryId];
}

function historyOccurrenceFromRow(
  row: PropagationPlanningOccurrence,
): PropagationHistoryOccurrence {
  return {
    offerItemId: row.offerItemId,
    requestNumber: row.requestNumber,
    submittedAtIso: row.submittedAtIso,
    offerSentAtIso: row.offerSentAtIso,
    unavailableReason: (row.unavailableReason || "other").trim(),
    customerFacingNotes: row.customerFacingNotes.trim(),
  };
}

export function oldestSubmittedAtIso(
  occurrences: Pick<PropagationPlanningOccurrence, "submittedAtIso">[],
): string {
  let oldest = "";
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const row of occurrences) {
    const ms = Date.parse(row.submittedAtIso);
    if (!Number.isFinite(ms)) continue;
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = row.submittedAtIso;
    }
  }
  return oldest || occurrences[0]?.submittedAtIso || "";
}

export function buildPropagationCategories(
  groups: PropagationPlanningGroup[],
): PropagationPlanningCategory[] {
  const byCategory = new Map<
    PropagationCategoryId,
    Map<string, PropagationCategoryPlantRow>
  >();

  for (const group of groups) {
    const byReason = new Map<PropagationCategoryId, PropagationPlanningOccurrence[]>();
    for (const occurrence of group.occurrences) {
      const categoryId = propagationCategoryIdForReason(occurrence.unavailableReason);
      const list = byReason.get(categoryId) ?? [];
      list.push(occurrence);
      byReason.set(categoryId, list);
    }

    for (const [categoryId, occurrences] of byReason.entries()) {
      const customers = new Set(occurrences.map((row) => row.customerKey));
      const sortedOccurrences = [...occurrences].sort(
        (left, right) =>
          new Date(right.offerSentAtIso).getTime() -
          new Date(left.offerSentAtIso).getTime(),
      );
      const otherOccurrences =
        categoryId === "other"
          ? sortedOccurrences.map((row) => ({
              offerItemId: row.offerItemId,
              requestNumber: row.requestNumber,
              submittedAtIso: row.submittedAtIso,
              offerSentAtIso: row.offerSentAtIso,
              customerFacingNotes: row.customerFacingNotes.trim(),
            }))
          : [];
      const historyOccurrences =
        categoryId === "other"
          ? []
          : sortedOccurrences.map(historyOccurrenceFromRow);

      const plantRow: PropagationCategoryPlantRow = {
        groupKey: group.groupKey,
        displayName: group.displayName,
        uniqueCustomerCount: customers.size,
        oldestRequestAtIso: oldestSubmittedAtIso(occurrences),
        newSinceDone: group.newSinceDone,
        newSinceClosed: group.newSinceClosed,
        state: group.state,
        historyOccurrences,
        otherOccurrences,
      };

      const plants = byCategory.get(categoryId) ?? new Map();
      plants.set(group.groupKey, plantRow);
      byCategory.set(categoryId, plants);
    }
  }

  return PROPAGATION_CATEGORY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    title: definition.title,
    actionLabel: definition.actionLabel,
    plants: [...(byCategory.get(definition.id)?.values() ?? [])],
  })).filter((category) => category.plants.length > 0);
}

export function buildPropagationTabs(
  groups: PropagationPlanningGroup[],
): PropagationPlanningTab[] {
  const byTab = new Map<PropagationTabId, Map<string, PropagationCategoryPlantRow>>();

  for (const group of groups) {
    const byTabReason = new Map<PropagationTabId, PropagationPlanningOccurrence[]>();
    for (const occurrence of group.occurrences) {
      const tabId = propagationTabIdForReason(occurrence.unavailableReason);
      const list = byTabReason.get(tabId) ?? [];
      list.push(occurrence);
      byTabReason.set(tabId, list);
    }

    for (const [tabId, occurrences] of byTabReason.entries()) {
      const customers = new Set(occurrences.map((row) => row.customerKey));
      const sortedOccurrences = [...occurrences].sort(
        (left, right) =>
          new Date(right.offerSentAtIso).getTime() -
          new Date(left.offerSentAtIso).getTime(),
      );
      const otherOccurrences =
        tabId === "other"
          ? sortedOccurrences.map((row) => ({
              offerItemId: row.offerItemId,
              requestNumber: row.requestNumber,
              submittedAtIso: row.submittedAtIso,
              offerSentAtIso: row.offerSentAtIso,
              customerFacingNotes: row.customerFacingNotes.trim(),
            }))
          : [];
      const historyOccurrences =
        tabId === "other"
          ? []
          : sortedOccurrences.map(historyOccurrenceFromRow);

      const plantRow: PropagationCategoryPlantRow = {
        groupKey: group.groupKey,
        displayName: group.displayName,
        uniqueCustomerCount: customers.size,
        oldestRequestAtIso: oldestSubmittedAtIso(occurrences),
        newSinceDone: group.newSinceDone,
        newSinceClosed: group.newSinceClosed,
        state: group.state,
        historyOccurrences,
        otherOccurrences,
      };

      const plants = byTab.get(tabId) ?? new Map();
      plants.set(group.groupKey, plantRow);
      byTab.set(tabId, plants);
    }
  }

  return PROPAGATION_TAB_DEFINITIONS.map((definition) => ({
    id: definition.id,
    title: definition.title,
    actionLabel: definition.actionLabel,
    plants: [...(byTab.get(definition.id)?.values() ?? [])],
  })).filter((tab) => tab.plants.length > 0);
}

export function filterPropagationCategories(
  categories: PropagationPlanningCategory[],
  status: PropagationStatusFilter,
  query: string,
): PropagationPlanningCategory[] {
  const normalized = query.trim().toLowerCase();
  return categories
    .map((category) => ({
      ...category,
      plants: category.plants.filter((plant) => {
        if (!propagationPlantMatchesStatus(plant.state, status)) return false;
        if (!normalized) return true;
        if (plant.displayName.toLowerCase().includes(normalized)) return true;
        return plant.otherOccurrences.some((row) =>
          row.requestNumber.toLowerCase().includes(normalized),
        );
      }),
    }))
    .filter((category) => category.plants.length > 0);
}

export function filterPropagationTabs(
  tabs: PropagationPlanningTab[],
  status: PropagationStatusFilter,
  query: string,
): PropagationPlanningTab[] {
  const normalized = query.trim().toLowerCase();
  return tabs
    .map((tab) => ({
      ...tab,
      plants: tab.plants.filter((plant) => {
        if (!propagationPlantMatchesStatus(plant.state, status)) return false;
        if (!normalized) return true;
        if (plant.displayName.toLowerCase().includes(normalized)) return true;
        return (
          plant.otherOccurrences.some((row) =>
            row.requestNumber.toLowerCase().includes(normalized),
          ) ||
          plant.historyOccurrences.some((row) =>
            row.requestNumber.toLowerCase().includes(normalized),
          )
        );
      }),
    }))
    .filter((tab) => tab.plants.length > 0);
}

export function sortPropagationCategoryPlants(
  categories: PropagationPlanningCategory[],
  sort: PropagationSort,
): PropagationPlanningCategory[] {
  return categories.map((category) => {
    const plants = [...category.plants];
    plants.sort((left, right) => {
      if (sort === "most_requested") {
        return (
          right.uniqueCustomerCount - left.uniqueCustomerCount ||
          left.displayName.localeCompare(right.displayName, undefined, {
            sensitivity: "base",
          })
        );
      }
      if (sort === "oldest_request") {
        return (
          Date.parse(left.oldestRequestAtIso) - Date.parse(right.oldestRequestAtIso) ||
          left.displayName.localeCompare(right.displayName, undefined, {
            sensitivity: "base",
          })
        );
      }
      return left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base",
      });
    });
    return { ...category, plants };
  });
}

export function sortPropagationTabPlants(
  tabs: PropagationPlanningTab[],
  sort: PropagationSort,
): PropagationPlanningTab[] {
  return tabs.map((tab) => {
    const plants = [...tab.plants];
    plants.sort((left, right) => {
      if (sort === "most_requested") {
        return (
          right.uniqueCustomerCount - left.uniqueCustomerCount ||
          left.displayName.localeCompare(right.displayName, undefined, {
            sensitivity: "base",
          })
        );
      }
      if (sort === "oldest_request") {
        return (
          Date.parse(left.oldestRequestAtIso) - Date.parse(right.oldestRequestAtIso) ||
          left.displayName.localeCompare(right.displayName, undefined, {
            sensitivity: "base",
          })
        );
      }
      return left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base",
      });
    });
    return { ...tab, plants };
  });
}

export function summarizePropagationCategories(
  groups: PropagationPlanningGroup[],
  allOccurrenceCountInRange: number,
): PropagationPlanningSummary {
  return summarizePropagationPlanning(groups, "all", allOccurrenceCountInRange);
}
