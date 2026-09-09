import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partitionPendingOfferItems,
  partitionPlantItemsByCustomerChoice,
  shouldGroupPendingOfferItems,
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

  it("groups expired unanswered offers into OFFERED then NOT AVAILABLE", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Expired", true, undefined),
      true,
    );
    const grouped = partitionPendingOfferItems([
      { id: "o", availability: "available" },
      { id: "n", availability: "not_available" },
    ] as RequestItem[]);
    assert.deepEqual(grouped.offered.map((item) => item.id), ["o"]);
    assert.deepEqual(grouped.notAvailable.map((item) => item.id), ["n"]);
  });

  it("groups closed unanswered all-unavailable into NOT AVAILABLE only", () => {
    assert.equal(shouldGroupPendingOfferItems("Closed", false, null), true);
    const grouped = partitionPendingOfferItems([
      { id: "only-na", availability: "not_available" },
    ] as RequestItem[]);
    assert.deepEqual(grouped.offered, []);
    assert.deepEqual(grouped.notAvailable.map((item) => item.id), ["only-na"]);
  });

  it("uses terminal grouping when the customer answered", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Expired", true, [
        { sourceItemId: "a", choice: "accept" },
      ]),
      false,
    );
  });
});
