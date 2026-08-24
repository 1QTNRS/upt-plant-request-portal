import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableQuantityFromLevel,
  exactPlantInventoryIdempotencyKey,
  isConcurrentIdempotencyError,
  isPreviousAttemptFailedIdempotencyError,
  isStaleInventoryError,
} from "./inventory-concurrency";

describe("inventory concurrency helpers", () => {
  it("treats both current and legacy stale codes as a compare-and-set miss", () => {
    assert.equal(
      isStaleInventoryError([{ code: "CHANGE_FROM_QUANTITY_STALE", message: "stale" }]),
      true,
    );
    assert.equal(
      isStaleInventoryError([{ code: "COMPARE_QUANTITY_STALE", message: "stale" }]),
      true,
    );
    assert.equal(
      isStaleInventoryError([{ code: "INVALID_QUANTITY_NEGATIVE", message: "no" }]),
      false,
    );
  });

  it("retries only Shopify's concurrent and previous-attempt idempotency codes", () => {
    assert.equal(
      isConcurrentIdempotencyError([
        { code: "IDEMPOTENCY_CONCURRENT_REQUEST", message: "in progress" },
      ]),
      true,
    );
    assert.equal(
      isPreviousAttemptFailedIdempotencyError([
        { code: "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED", message: "failed" },
      ]),
      true,
    );
    assert.equal(
      isConcurrentIdempotencyError([
        { message: "This request is currently in progress, please try again." },
      ]),
      true,
    );
    assert.equal(
      isConcurrentIdempotencyError([
        { code: "IDEMPOTENCY_KEY_PARAMETER_MISMATCH", message: "mismatch" },
      ]),
      false,
    );
  });

  it("reads the available quantity and refuses to guess when Shopify omits it", () => {
    assert.equal(availableQuantityFromLevel([{ name: "available", quantity: 1 }]), 1);
    assert.throws(
      () => availableQuantityFromLevel([{ name: "on_hand", quantity: 1 }]),
      /did not return the available quantity/,
    );
  });

  it("keeps activate keys stable across retries of the same listing", () => {
    assert.equal(
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "activate",
      }),
      exactPlantInventoryIdempotencyKey({
        requestItemId: "item_1",
        operation: "activate",
      }),
    );
  });
});
