import { canonicalPlantKey } from "./plant-identity";
import { normalizeUnavailableReason, type UnavailableReason } from "./portal";

export type PropagationDateRange = "all" | "90d" | "30d";

export type PropagationStatusFilter = "needs" | "done" | "all";

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

export type PropagationCategoryPlantRow = {
  groupKey: string;
  displayName: string;
  uniqueCustomerCount: number;
  oldestRequestAtIso: string;
  newSinceDone: number;
  state: PropagationPlanningStateView;
  otherOccurrences: PropagationCategoryOtherOccurrence[];
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
  completedAtIso: string | null;
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
  state: PropagationPlanningStateView;
  occurrences: PropagationPlanningOccurrence[];
};

export type PropagationPlanningSummary = {
  needsPropagation: number;
  done: number;
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
  propNotes: string;
  updatedAt: Date;
};

export function mergePlanningStateRows(
  rows: PropagationPlanningStateRow[],
): PropagationPlanningStateView {
  if (rows.length === 0) {
    return { done: false, completedAtIso: null, propNotes: "", updatedAtIso: null };
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
  const propNotes = sorted.find((row) => row.propNotes.trim())?.propNotes ?? primary.propNotes;
  return {
    done: completedAt != null,
    completedAtIso: completedAt?.toISOString() ?? null,
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
    if (status === "needs" && group.state.done) return false;
    if (status === "done" && !group.state.done) return false;
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
    needsPropagation: groups.filter((group) => !group.state.done).length,
    done: groups.filter((group) => group.state.done).length,
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
      const otherOccurrences =
        categoryId === "other"
          ? [...occurrences]
              .sort(
                (left, right) =>
                  new Date(right.offerSentAtIso).getTime() -
                  new Date(left.offerSentAtIso).getTime(),
              )
              .map((row) => ({
                offerItemId: row.offerItemId,
                requestNumber: row.requestNumber,
                submittedAtIso: row.submittedAtIso,
                offerSentAtIso: row.offerSentAtIso,
                customerFacingNotes: row.customerFacingNotes.trim(),
              }))
          : [];

      const plantRow: PropagationCategoryPlantRow = {
        groupKey: group.groupKey,
        displayName: group.displayName,
        uniqueCustomerCount: customers.size,
        oldestRequestAtIso: oldestSubmittedAtIso(occurrences),
        newSinceDone: group.newSinceDone,
        state: group.state,
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
        if (status === "needs" && plant.state.done) return false;
        if (status === "done" && !plant.state.done) return false;
        if (!normalized) return true;
        if (plant.displayName.toLowerCase().includes(normalized)) return true;
        return plant.otherOccurrences.some((row) =>
          row.requestNumber.toLowerCase().includes(normalized),
        );
      }),
    }))
    .filter((category) => category.plants.length > 0);
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

export function summarizePropagationCategories(
  groups: PropagationPlanningGroup[],
  allOccurrenceCountInRange: number,
): PropagationPlanningSummary {
  return summarizePropagationPlanning(groups, "all", allOccurrenceCountInRange);
}
