import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partitionPlantItemsByCustomerChoice,
  shouldGroupTerminalPlantItems,
} from "./terminal-response";
import type { RequestItem } from "./types";

function item(id: string): RequestItem {
  return {
    id,
    plantName: id,
    offeredName: id,
    availability: "available",
    fulfillmentType: "exact_plant",
    price: 100,
    weightLbs: 1,
    customerFacingNotes: "",
    adminNotes: "",
    photoUrls: [],
    photos: [],
  };
}

describe("terminal response grouping", () => {
  it("partitions accepted and declined items for terminal detail", () => {
    const grouped = partitionPlantItemsByCustomerChoice(
      [item("a"), item("b")],
      [
        { sourceItemId: "a", choice: "accept" },
        { sourceItemId: "b", choice: "reject" },
      ],
    );
    assert.deepEqual(
      grouped.accepted.map((entry) => entry.id),
      ["a"],
    );
    assert.deepEqual(
      grouped.declined.map((entry) => entry.id),
      ["b"],
    );
  });

  it("groups only Closed or Expired requests with explicit accept/reject answers", () => {
    assert.equal(
      shouldGroupTerminalPlantItems("Closed", [{ sourceItemId: "a", choice: "accept" }]),
      true,
    );
    assert.equal(
      shouldGroupTerminalPlantItems("Expired", [{ sourceItemId: "a", choice: "reject" }]),
      true,
    );
    assert.equal(shouldGroupTerminalPlantItems("Pending", []), false);
  });
});
