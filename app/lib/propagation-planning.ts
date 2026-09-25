import { canonicalPlantKey } from "./plant-identity";

export type PropagationDateRange = "all" | "90d" | "30d";

export type PropagationStatusFilter = "needs" | "done" | "all";

export type PropagationSort = "most_requested" | "most_recent" | "az";

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
    if (sort === "most_recent") {
      return right.lastRequestedAtIso.localeCompare(left.lastRequestedAtIso);
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
