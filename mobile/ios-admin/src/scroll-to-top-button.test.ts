import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  scrollToTopButtonVisible,
  SCROLL_TO_TOP_HIDE_NEAR_TOP,
  SCROLL_TO_TOP_SHOW_THRESHOLD,
} from "./scroll-to-top-button";

describe("scroll-to-top button visibility", () => {
  it("stays hidden near the top and appears after meaningful scroll", () => {
    assert.equal(scrollToTopButtonVisible(0), false);
    assert.equal(scrollToTopButtonVisible(SCROLL_TO_TOP_HIDE_NEAR_TOP), false);
    assert.equal(scrollToTopButtonVisible(80), false);
    assert.equal(scrollToTopButtonVisible(SCROLL_TO_TOP_SHOW_THRESHOLD), true);
    assert.equal(scrollToTopButtonVisible(400), true);
  });
});

describe("PropagationPlanning scroll-to-top wiring", () => {
  it("keeps native scrollsToTop and adds a floating Top control", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "PropagationPlanningScreen.tsx"),
      "utf8",
    );
    assert.match(source, /usePrimaryScrollProps/);
    assert.match(source, /scrollToTopButtonVisible/);
    assert.match(source, /scrollRef\.current\?\.scrollTo/);
  });
});
