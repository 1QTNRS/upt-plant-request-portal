import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  requestPageKeyboardDismissMode,
  requestPageKeyboardShouldPersistTaps,
  requestPageScrollEnabledWhileStockOpen,
  shouldDismissStockSearch,
  stockDropdownAfterFulfillmentChange,
  stockDropdownAfterNavigateAway,
  stockDropdownAfterOutsideDismiss,
  stockDropdownOpen,
  stockSearchConsumesOutsidePress,
} from "./item-editor";

const editor = readFileSync(
  path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
  "utf8",
);
const detail = readFileSync(
  path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
  "utf8",
);

describe("Link Stock dropdown dismiss", () => {
  it("opens during search", () => {
    assert.equal(stockDropdownOpen(true, "albo", false, true, false), true);
    assert.equal(stockDropdownOpen(true, "albo", true, false, false), true);
    assert.match(editor, /Search live website stock/);
    assert.match(editor, /styles\.dropdown/);
  });

  it("closes when tapping outside the input or dropdown", () => {
    const dismissed = stockDropdownAfterOutsideDismiss();
    assert.equal(shouldDismissStockSearch("outside"), true);
    assert.equal(shouldDismissStockSearch("page-control"), true);
    assert.equal(stockSearchConsumesOutsidePress("input"), true);
    assert.equal(stockSearchConsumesOutsidePress("dropdown"), true);
    assert.equal(
      stockDropdownOpen(dismissed.focused, "albo", true, false, dismissed.closed),
      false,
    );
    assert.match(detail, /onTouchStart=\{dismissStockSearches\}/);
    assert.match(editor, /stopPropagation/);
    assert.match(editor, /styles\.stockHit/);
  });

  it("lets the keyboard dismiss on an outside tap", () => {
    assert.equal(requestPageKeyboardShouldPersistTaps(), "handled");
    assert.equal(requestPageKeyboardDismissMode(), "on-drag");
    assert.match(detail, /keyboardShouldPersistTaps="handled"/);
    assert.match(detail, /keyboardDismissMode="on-drag"/);
    assert.match(detail, /Keyboard\.dismiss/);
    assert.match(editor, /keyboardDismissMode="none"/);
  });

  it("keeps page controls tappable after dismissal and never locks page scroll", () => {
    assert.equal(requestPageScrollEnabledWhileStockOpen(), true);
    assert.doesNotMatch(detail, /scrollEnabled=\{!stockDropdownOpen\}/);
    assert.match(detail, /dismissStockSearches/);
    assert.match(detail, /registerStockDismiss/);
    assert.match(detail, /ui\.expirationDays/);
    assert.match(detail, /Send offer/);
  });

  it("closes when switching Exact Plant / Link Stock / Not Available", () => {
    assert.equal(shouldDismissStockSearch("fulfillment"), true);
    const switched = stockDropdownAfterFulfillmentChange();
    assert.equal(switched.closed, true);
    assert.equal(switched.resultsCleared, true);
    assert.match(editor, /async function setRoute/);
    assert.match(editor, /dismissStockSearch\(\);/);
    assert.match(editor, /\(\["exact_plant", "growers_choice", "not_available"\]/);
  });

  it("resets when leaving the request", () => {
    const left = stockDropdownAfterNavigateAway();
    assert.equal(left.closed, true);
    assert.equal(left.resultsCleared, true);
    assert.match(detail, /stockDismissers\.current\.clear/);
    assert.match(editor, /registerStockDismissRef\.current\?\.\(item\.id, null\)/);
  });

  it("still selects an in-stock result", () => {
    assert.equal(stockSearchConsumesOutsidePress("result"), true);
    assert.equal(shouldDismissStockSearch("result"), false);
    assert.match(editor, /intent: "link-stock"/);
    assert.match(editor, /setStockClosed\(true\)/);
    assert.match(editor, /canSelectStockCandidate/);
    assert.match(editor, /disabled=\{!selectable\}/);
  });

  it("keeps the dropdown itself vertically scrollable", () => {
    assert.match(editor, /GestureScrollView/);
    assert.match(editor, /nestedScrollEnabled/);
    assert.match(editor, /STOCK_DROPDOWN_MAX_HEIGHT/);
    assert.match(editor, /keyboardShouldPersistTaps="always"/);
  });
});
