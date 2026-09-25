import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildRequestListIndexes,
  visibleRequestsFromIndexes,
} from "./request-filters";
import type { RequestRow } from "./types";

const listSource = readFileSync(
  path.join(import.meta.dirname, "screens", "RequestListScreen.tsx"),
  "utf8",
);

function row(id: string, status: RequestRow["status"]): RequestRow {
  return {
    id,
    requestNumber: id.toUpperCase(),
    customer: "Alex",
    email: "alex@example.com",
    plantsRequested: "Plant",
    status,
    submittedAtIso: "2026-01-01T00:00:00.000Z",
    hasResponded: false,
    hasExistingOrder: false,
  };
}

describe("Closed filter responsiveness", () => {
  it("does not refetch when switching status filters locally", () => {
    assert.doesNotMatch(listSource, /loadList\([^)]*statusFilter/);
    assert.match(listSource, /useDeferredValue\(statusFilter\)/);
    assert.match(listSource, /buildRequestListIndexes/);
    assert.match(listSource, /visibleRequestsFromIndexes/);
  });

  it("selects Closed rows from precomputed indexes", () => {
    const indexes = buildRequestListIndexes([
      row("closed-1", "Closed"),
      row("expired-1", "Expired"),
      row("new-1", "New"),
    ]);
    const closed = visibleRequestsFromIndexes(indexes, "Closed", "", "newest");
    assert.deepEqual(
      closed.map((item) => item.id).sort(),
      ["closed-1", "expired-1"],
    );
  });
});
