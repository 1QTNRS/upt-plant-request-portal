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
): RequestRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesStatusFilter(row, filter)) return false;
    if (!needle) return true;
    return [row.customer, row.email, row.requestNumber, row.plantsRequested]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
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
