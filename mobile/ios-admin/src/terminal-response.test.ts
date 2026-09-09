import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partitionPlantItemsByCustomerChoice,
  shouldGroupTerminalPlantItems,
} from "./terminal-response";
import type { RequestItem } from "./types";

describe("terminal plant grouping", () => {
  const items = [
    {
      id: "a",
      plantName: "Monstera",
      availability: "available",
    },
    {
      id: "b",
      plantName: "Philodendron",
      availability: "available",
    },
    {
      id: "c",
      plantName: "Hoya",
      availability: "not_available",
    },
  ] as RequestItem[];

  it("partitions accepted, declined, and not available", () => {
    const grouped = partitionPlantItemsByCustomerChoice(
      items,
      [
        { sourceItemId: "a", choice: "accept" },
        { sourceItemId: "b", choice: "reject" },
        { sourceItemId: "c", choice: "unavailable" },
      ],
    );
    assert.deepEqual(
      grouped.accepted.map((item) => item.id),
      ["a"],
    );
    assert.deepEqual(
      grouped.declined.map((item) => item.id),
      ["b"],
    );
    assert.deepEqual(
      grouped.notAvailable.map((item) => item.id),
      ["c"],
    );
  });

  it("groups pending unpaid responses", () => {
    assert.equal(
      shouldGroupTerminalPlantItems("Pending", [
        { sourceItemId: "a", choice: "accept" },
      ]),
      true,
    );
  });
});
