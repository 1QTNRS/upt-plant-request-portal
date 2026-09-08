import type { RequestRow, Stats } from "./types";

export const DEFAULT_STATUS_FILTER = "New";

export const STATUS_FILTERS = [
  { value: "New", label: "New" },
  { value: "Pending", label: "Pending" },
  { value: "Closed", label: "Closed" },
  { value: "Expired", label: "Expired" },
  { value: "ExistingOrder", label: "Existing Order" },
] as const;

export type StatusFilterValue = (typeof STATUS_FILTERS)[number]["value"];

/** Mirrors `ClosedRequestSort` in `app/lib/portal.ts`. */
export type ClosedRequestSort = "newest" | "oldest";

export function parseClosedRequestSort(
  value: string | null | undefined,
): ClosedRequestSort {
  return value === "oldest" ? "oldest" : "newest";
}

export function closedRequestSortLabel(sort: ClosedRequestSort): string {
  return sort === "oldest" ? "Oldest Closed" : "Newest Closed";
}

/**
 * Milliseconds used to sort Closed rows. Missing/invalid closedAt sorts as 0
 * so the list stays deterministic and never throws.
 */
export function closedRequestSortTime(row: {
  closedAtIso?: string | null;
}): number {
  if (!row.closedAtIso) return 0;
  const time = Date.parse(String(row.closedAtIso));
  return Number.isFinite(time) ? time : 0;
}

export function sortClosedRequests<
  T extends { closedAtIso?: string | null },
>(rows: T[], sort: ClosedRequestSort = "newest"): T[] {
  return [...rows].sort((left, right) => {
    const delta = closedRequestSortTime(right) - closedRequestSortTime(left);
    return sort === "newest" ? delta : -delta;
  });
}

export function matchesStatusFilter(
  row: Pick<RequestRow, "status" | "hasExistingOrder">,
  filter: string,
): boolean {
  if (filter === "ExistingOrder") {
    return row.status === "New" && row.hasExistingOrder === true;
  }
  if (filter === "All") return true;
  return row.status === filter;
}

export function filterRequestRows(
  rows: RequestRow[],
  filter: string,
  query = "",
  closedSort: ClosedRequestSort = "newest",
): RequestRow[] {
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!matchesStatusFilter(row, filter)) return false;
    if (!needle) return true;
    return [row.customer, row.email, row.requestNumber, row.plantsRequested]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  if (filter !== "Closed") return filtered;
  return sortClosedRequests(filtered, closedSort);
}

export function statusFilterCounts(
  rows: RequestRow[],
  stats?: Stats | null,
): Record<StatusFilterValue, number> {
  return {
    New: stats?.newRequests ?? rows.filter((row) => row.status === "New").length,
    Pending: stats?.pending ?? rows.filter((row) => row.status === "Pending").length,
    Closed: stats?.closed ?? rows.filter((row) => row.status === "Closed").length,
    Expired: stats?.expired ?? rows.filter((row) => row.status === "Expired").length,
    ExistingOrder: rows.filter(
      (row) => row.status === "New" && row.hasExistingOrder === true,
    ).length,
  };
}
