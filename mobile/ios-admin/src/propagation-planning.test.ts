import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS propagation planning navigation", () => {
  it("adds a Settings stack without a fourth root tab", () => {
    const app = read("App.tsx");
    assert.match(app, /createMaterialTopTabNavigator/);
    assert.match(app, /name="Requests"/);
    assert.match(app, /name="ExactPlants"/);
    assert.match(app, /name="Settings"/);
    assert.match(app, /SettingsNavigator/);
    assert.match(app, /PropagationPlanning/);
    assert.doesNotMatch(app, /name="Propagation"/);
  });

  it("shows a Settings entry card and dedicated planning screen", () => {
    const settings = read("src/screens/SettingsScreen.tsx");
    assert.match(settings, /Propagation Planning/);
    assert.match(settings, /navigation\.navigate\("PropagationPlanning"\)/);
    const screen = read("src/screens/PropagationPlanningScreen.tsx");
    assert.match(screen, /Propagation Planning/);
    assert.match(screen, /navigation\.goBack\(\)/);
    assert.match(screen, /Save Prop Notes/);
    assert.match(screen, /useRootTabBarHiddenOnFocus/);
  });

  it("types propagation planning API payloads", () => {
    const types = read("src/types.ts");
    assert.match(types, /PropagationPlanningGroup/);
    assert.match(types, /PropagationPlanningOccurrence/);
    assert.match(types, /PropagationPlanningPayload/);
  });
});
