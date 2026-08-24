import { createHash } from "node:crypto";

import { EXACT_PLANT_STOCK_QUANTITY } from "./exact-plants";

/**
 * Deterministic idempotency keys for Exact Plant inventory mutations.
 *
 * Shopify requires `@idempotent` on inventoryActivate / inventorySetQuantities
 * from 2026-04. Retries of the same logical operation must reuse the same key;
 * a new listing, a different mutation, or a new compare-and-set expected
 * quantity is a different operation and must not.
 */
const IDEMPOTENCY_NAMESPACE = "upt.exact-plant.inventory.v1";

export type ExactPlantInventoryOperation = "activate" | "set";

export const INVENTORY_STALE_CODES = new Set([
  "CHANGE_FROM_QUANTITY_STALE",
  "COMPARE_QUANTITY_STALE",
]);

export const INVENTORY_CONCURRENT_IDEMPOTENCY_CODE = "IDEMPOTENCY_CONCURRENT_REQUEST";

export const INVENTORY_PREVIOUS_ATTEMPT_FAILED_CODE =
  "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED";

export const MAX_INVENTORY_MUTATION_ATTEMPTS = 3;

export const INVENTORY_RETRY_DELAY_MS = 25;

export type InventoryUserError = {
  code?: string | null;
  message: string;
};

export function exactPlantInventoryIdempotencyKey(input: {
  requestItemId: string;
  operation: ExactPlantInventoryOperation;
  changeFromQuantity?: number;
}): string {
  const material = [
    IDEMPOTENCY_NAMESPACE,
    input.requestItemId,
    input.operation,
    input.operation === "set" ? String(input.changeFromQuantity) : "",
    String(EXACT_PLANT_STOCK_QUANTITY),
  ].join("\0");
  const hash = createHash("sha256").update(material).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function inventoryErrorCodes(errors: InventoryUserError[] | undefined): string[] {
  return (errors ?? []).map((error) => error.code).filter((code): code is string => Boolean(code));
}

export function isStaleInventoryError(errors: InventoryUserError[] | undefined): boolean {
  return inventoryErrorCodes(errors).some((code) => INVENTORY_STALE_CODES.has(code));
}

export function isConcurrentIdempotencyError(
  errors: InventoryUserError[] | undefined,
): boolean {
  return inventoryErrorCodes(errors).includes(INVENTORY_CONCURRENT_IDEMPOTENCY_CODE);
}

export function isPreviousAttemptFailedIdempotencyError(
  errors: InventoryUserError[] | undefined,
): boolean {
  return inventoryErrorCodes(errors).includes(INVENTORY_PREVIOUS_ATTEMPT_FAILED_CODE);
}

export function availableQuantityFromLevel(
  quantities: Array<{ name: string; quantity: number }> | null | undefined,
): number {
  const available = quantities?.find((entry) => entry.name === "available")?.quantity;
  if (typeof available !== "number") {
    throw new Error(
      "Shopify did not return the available quantity for this exact plant, so stock cannot be set safely.",
    );
  }
  return available;
}
