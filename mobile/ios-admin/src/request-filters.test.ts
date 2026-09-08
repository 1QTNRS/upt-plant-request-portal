import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTERS,
  closedRequestSortLabel,
  filterRequestRows,
  parseClosedRequestSort,
  sortClosedRequests,
  statusFilterCounts,
} from "./request-filters";
import type { RequestRow } from "./types";

function row(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "req-1",
    requestNumber: "REQ1",
    customer: "Alex Rivera",
    email: "alex@example.com",
    plantsRequested: "Monstera",
    status: "New",
    submittedAtIso: "2026-08-20T16:00:00.000Z",
    hasResponded: false,
    hasExistingOrder: false,
    ...overrides,
  };
}

const rows = [
  row({ id: "new", requestNumber: "REQ1", status: "New" }),
  row({
    id: "existing",
    requestNumber: "REQ2",
    status: "New",
    hasExistingOrder: true,
    plantsRequested: "Albo",
  }),
  row({ id: "pending", requestNumber: "REQ3", status: "Pending", customer: "Jordan" }),
  row({ id: "closed", requestNumber: "REQ4", status: "Closed" }),
  row({ id: "expired", requestNumber: "REQ5", status: "Expired" }),
];

describe("request status filters", () => {
  it("defaults to New and has no dedicated Expired filter", () => {
    assert.equal(DEFAULT_STATUS_FILTER, "New");
    assert.deepEqual(
      STATUS_FILTERS.map((filter) => filter.value),
      ["New", "Pending", "Closed", "ExistingOrder"],
    );
  });

  it("returns only the rows for each status control", () => {
    assert.deepEqual(
      filterRequestRows(rows, "New").map((item) => item.id),
      ["new", "existing"],
    );
    assert.deepEqual(
      filterRequestRows(rows, "Pending").map((item) => item.id),
      ["pending"],
    );
    assert.deepEqual(
      filterRequestRows(rows, "Closed").map((item) => item.id).sort(),
      ["closed", "expired"],
    );
    assert.deepEqual(
      filterRequestRows(rows, "ExistingOrder").map((item) => item.id),
      ["existing"],
    );
  });

  it("keeps Expired stored status while showing it under Closed", () => {
    const visible = filterRequestRows(rows, "Closed");
    assert.equal(visible.find((item) => item.id === "expired")?.status, "Expired");
    assert.equal(visible.find((item) => item.id === "closed")?.status, "Closed");
  });

  it("shows counts for the combined status controls", () => {
    const counts = statusFilterCounts(rows, {
      newRequests: 2,
      pending: 1,
      closed: 1,
      expired: 1,
    });
    assert.equal(counts.New, 2);
    assert.equal(counts.Pending, 1);
    assert.equal(counts.Closed, 2);
    assert.equal(counts.ExistingOrder, 1);
    assert.ok(!("Expired" in counts));
  });
});

describe("closed request sorting", () => {
  const closed = [
    row({
      id: "old-close-new-submit",
      status: "Closed",
      closedAtIso: "2026-01-01T00:00:00.000Z",
      submittedAtIso: "2026-06-01T00:00:00.000Z",
    }),
    row({
      id: "new-close-old-submit",
      status: "Closed",
      closedAtIso: "2026-06-01T00:00:00.000Z",
      submittedAtIso: "2026-01-01T00:00:00.000Z",
    }),
    row({
      id: "missing-closed-at",
      status: "Closed",
      closedAtIso: undefined,
      submittedAtIso: "2026-12-01T00:00:00.000Z",
    }),
  ];

  it("defaults to newest terminal order", () => {
    assert.equal(parseClosedRequestSort(null), "newest");
    assert.equal(closedRequestSortLabel("newest"), "Newest");
    assert.deepEqual(
      filterRequestRows(closed, "Closed").map((item) => item.id),
      ["new-close-old-submit", "old-close-new-submit", "missing-closed-at"],
    );
  });

  it("sorts newest and oldest by terminal timestamps", () => {
    const terminal = [
      row({
        id: "closed-old",
        status: "Closed",
        closedAtIso: "2026-01-01T00:00:00.000Z",
        submittedAtIso: "2026-12-01T00:00:00.000Z",
      }),
      row({
        id: "expired-new",
        status: "Expired",
        expiredAtIso: "2026-06-01T00:00:00.000Z",
        submittedAtIso: "2026-01-01T00:00:00.000Z",
      }),
    ];
    assert.deepEqual(
      sortClosedRequests(terminal, "newest").map((item) => item.id),
      ["expired-new", "closed-old"],
    );
    assert.deepEqual(
      filterRequestRows(terminal, "Closed", "", "oldest").map((item) => item.id),
      ["closed-old", "expired-new"],
    );
  });
});
