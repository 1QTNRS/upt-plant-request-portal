import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  applyItemDraft,
  AUTOSAVE_DEBOUNCE_MS,
  autosaveLabel,
  draftToSavePayload,
  itemLooksSendable,
  parseDecimalInput,
  requestLooksSendable,
  shouldDebounceSave,
} from "./item-autosave";
import type { RequestItem } from "./types";

function item(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "item-1",
    plantName: "Monstera",
    offeredName: "Monstera Albo",
    availability: "available",
    fulfillmentType: "exact_plant",
    price: 0,
    weightLbs: 0,
    customerFacingNotes: "",
    adminNotes: "",
    photoUrls: [],
    photos: [{ id: "p1", url: "https://cdn.example/1.jpg" }],
    ...overrides,
  };
}

describe("item autosave", () => {
  it("parses complete decimals and holds a trailing-dot value as incomplete", () => {
    assert.deepEqual(parseDecimalInput("12.50"), { ok: true, value: 12.5, complete: true });
    assert.deepEqual(parseDecimalInput("0.5"), { ok: true, value: 0.5, complete: true });
    assert.deepEqual(parseDecimalInput("12."), { ok: true, value: 12, complete: false });
    assert.equal(parseDecimalInput(".").ok, false);
  });

  it("does not treat a trailing-dot pause as a finished save payload of NaN", () => {
    const payload = draftToSavePayload({
      offeredName: "Monstera",
      priceText: "12.",
      weightText: "0.5",
      customerFacingNotes: "",
    });
    assert.equal(payload.price, 12);
    assert.equal(payload.weightLbs, 0.5);
    assert.equal(
      shouldDebounceSave({
        offeredName: "Monstera",
        priceText: "12.",
        weightText: "0.5",
        customerFacingNotes: "",
      }),
      false,
    );
    assert.equal(
      shouldDebounceSave({
        offeredName: "Monstera",
        priceText: "12.50",
        weightText: "0.5",
        customerFacingNotes: "",
      }),
      true,
    );
  });

  it("lets Send Offer see a just-typed price and weight", () => {
    const typed = applyItemDraft(item(), {
      offeredName: "Monstera Albo",
      priceText: "120",
      weightText: "2",
      customerFacingNotes: "",
    });
    assert.equal(itemLooksSendable(typed), true);
    assert.equal(requestLooksSendable([typed]), true);
    assert.equal(itemLooksSendable(item()), false);
  });

  it("debounces typing instead of saving every keystroke", () => {
    assert.equal(AUTOSAVE_DEBOUNCE_MS, 450);
    assert.ok(AUTOSAVE_DEBOUNCE_MS >= 400);
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(editor, /AUTOSAVE_DEBOUNCE_MS/);
    assert.match(editor, /shouldDebounceSave/);
    assert.doesNotMatch(editor, /Save item/);
    assert.match(editor, /autosaveLabel/);
  });

  it("flushes pending saves before Send Offer", () => {
    const detail = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(detail, /flushPendingSaves/);
    assert.match(detail, /registerFlush/);
    assert.match(detail, /const flushed = await flushPendingSaves/);
    assert.match(detail, /if \(!flushed\)/);
    assert.match(detail, /intent: "send-offer"/);
    assert.ok(detail.indexOf("flushPendingSaves") < detail.indexOf('intent: "send-offer"'));
    assert.doesNotMatch(detail, /Save item/);
    assert.match(editor, /persistDraftRef\.current\(\{ flush: true/);
    assert.match(editor, /\[item\.id\]/);
  });

  it("surfaces a failed autosave", () => {
    assert.equal(autosaveLabel("failed"), "Couldn’t save");
    assert.equal(autosaveLabel("saving"), "Saving…");
    assert.equal(autosaveLabel("saved"), "Saved");
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(editor, /Couldn’t save/);
    assert.match(editor, / · Retry/);
  });
});
