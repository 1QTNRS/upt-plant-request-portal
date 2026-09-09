import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { tabSwipeEnabled } from "./tab-swipe";

describe("root tab pager swipe", () => {
  it("allows pager swipe on root list routes", () => {
    assert.equal(tabSwipeEnabled("RequestList"), true);
    assert.equal(tabSwipeEnabled("ExactPlantsList"), true);
    assert.equal(tabSwipeEnabled(undefined), true);
  });

  it("blocks pager swipe on detail and review routes", () => {
    assert.equal(tabSwipeEnabled("RequestDetail"), false);
    assert.equal(tabSwipeEnabled("ExactPlantsReview"), false);
  });

  it("uses material top tabs with pager view and focus-hook swipe gating", () => {
    const app = readFileSync(path.join(import.meta.dirname, "..", "App.tsx"), "utf8");
    assert.match(app, /createMaterialTopTabNavigator/);
    assert.match(app, /tabBarPosition="bottom"/);
    assert.doesNotMatch(app, /RootTabSwipeShell/);
    assert.match(app, /rootMaterialTabScreenOptions/);
    const hooks = readFileSync(
      path.join(import.meta.dirname, "use-root-tab-bar.ts"),
      "utf8",
    );
    assert.match(hooks, /swipeEnabled/);
    const chrome = readFileSync(
      path.join(import.meta.dirname, "navigation-chrome.ts"),
      "utf8",
    );
    assert.match(chrome, /rootTabBarStyle/);
    assert.match(chrome, /rootTabBarVisible/);
    const viewer = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoViewer.tsx"),
      "utf8",
    );
    assert.match(viewer, /Modal visible/);
    assert.match(app, /gestureEnabled: true/);
    assert.match(app, /fullScreenGestureEnabled: false/);
    assert.match(app, /name="Requests"/);
    assert.match(app, /name="ExactPlants"/);
    assert.match(app, /name="Settings"/);
    assert.match(app, /title: "Requests"/);
    assert.match(app, /title: "EXACT PLANTS"/);
    assert.match(app, /title: "Settings"/);
  });
});
