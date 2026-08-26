import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTERS,
  filterRequestRows,
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
  it("defaults to New and has no duplicate All row", () => {
    assert.equal(DEFAULT_STATUS_FILTER, "New");
    assert.deepEqual(
      STATUS_FILTERS.map((filter) => filter.value),
      ["New", "Pending", "Closed", "Expired", "ExistingOrder"],
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
      filterRequestRows(rows, "Closed").map((item) => item.id),
      ["closed"],
    );
    assert.deepEqual(
      filterRequestRows(rows, "Expired").map((item) => item.id),
      ["expired"],
    );
    assert.deepEqual(
      filterRequestRows(rows, "ExistingOrder").map((item) => item.id),
      ["existing"],
    );
  });

  it("keeps the selected filter when search and refresh reuse the same rows", () => {
    const refreshed = [...rows, row({ id: "new-2", requestNumber: "REQ6", status: "New" })];
    const visible = filterRequestRows(refreshed, "Pending", "");
    assert.deepEqual(
      visible.map((item) => item.id),
      ["pending"],
    );
    assert.equal(filterRequestRows(refreshed, "New", "Albo")[0]?.id, "existing");
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
    assert.equal(counts.Closed, 1);
    assert.equal(counts.Expired, 1);
    assert.equal(counts.ExistingOrder, 1);
  });
});
