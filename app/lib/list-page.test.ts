import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { padPageSlots, paginateItems } from "./list-page";

describe("paginateItems", () => {
  it("slices 10-at-a-time and clamps the page", () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    const first = paginateItems(items, 1, 10);
    assert.deepEqual(first.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(first.pageCount, 3);
    assert.equal(first.start, 1);
    assert.equal(first.end, 10);

    const last = paginateItems(items, 3, 10);
    assert.deepEqual(last.items, [21, 22, 23]);
    assert.equal(last.start, 21);
    assert.equal(last.end, 23);

    assert.equal(paginateItems(items, 99, 10).page, 3);
    assert.equal(paginateItems(items, 0, 10).page, 1);
  });

  it("slices EXACT PLANTS 25 at a time", () => {
    const items = Array.from({ length: 30 }, (_, index) => index + 1);
    const first = paginateItems(items, 1, 25);
    assert.equal(first.items.length, 25);
    assert.equal(first.pageCount, 2);
    assert.deepEqual(paginateItems(items, 2, 25).items, [26, 27, 28, 29, 30]);
  });

  it("pads a short page to the page size", () => {
    assert.deepEqual(padPageSlots([1, 2], 4), [1, 2, null, null]);
    assert.deepEqual(padPageSlots([1, 2, 3, 4], 4), [1, 2, 3, 4]);
  });

  it("keeps an empty list on page 1", () => {
    const empty = paginateItems([], 4, 25);
    assert.equal(empty.page, 1);
    assert.equal(empty.pageCount, 1);
    assert.equal(empty.total, 0);
    assert.equal(empty.start, 0);
    assert.equal(empty.end, 0);
  });
});
