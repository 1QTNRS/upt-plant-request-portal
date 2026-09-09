import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  adjacentMainTab,
  swipeDirectionToAdjacent,
  tabSwipeEnabled,
} from "./tab-swipe";

describe("root tab swipe", () => {
  it("moves Requests to EXACT PLANTS on a left swipe", () => {
    assert.equal(adjacentMainTab("Requests", "left"), "ExactPlants");
    assert.equal(swipeDirectionToAdjacent("Requests", -80), "ExactPlants");
  });

  it("moves EXACT PLANTS to Settings on a left swipe", () => {
    assert.equal(adjacentMainTab("ExactPlants", "left"), "Settings");
  });

  it("moves back on a right swipe", () => {
    assert.equal(adjacentMainTab("Settings", "right"), "ExactPlants");
    assert.equal(adjacentMainTab("ExactPlants", "right"), "Requests");
    assert.equal(adjacentMainTab("Requests", "right"), null);
  });

  it("keeps detail routes from receiving root-tab swipe gestures and isolates the photo viewer", () => {
    assert.equal(tabSwipeEnabled("RequestList"), true);
    assert.equal(tabSwipeEnabled("RequestDetail"), false);
    assert.equal(tabSwipeEnabled("ExactPlantsReview"), false);
    assert.equal(swipeDirectionToAdjacent("ExactPlants", -80), "Settings");
    assert.equal(swipeDirectionToAdjacent("Settings", 80), "ExactPlants");
    const app = readFileSync(path.join(import.meta.dirname, "..", "App.tsx"), "utf8");
    assert.match(app, /createBottomTabNavigator/);
    assert.doesNotMatch(app, /createMaterialTopTabNavigator/);
    assert.match(app, /rootTabBarLabelOnlyOptions/);
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
