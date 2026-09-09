import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS text input keyboard focus", () => {
  it("does not restore tab bar in layout-effect cleanup when safe area changes", () => {
    const hooks = read("src/use-root-tab-bar.ts");
    assert.match(hooks, /bottomInsetRef/);
    assert.doesNotMatch(hooks, /return \(\) => \{[\s\S]*setRootTabChrome[\s\S]*true, true/);
    assert.match(hooks, /if \(!isFocused\) return/);
  });

  it("avoids Keyboard.dismiss on request detail initial load", () => {
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /dismissOverlays/);
    assert.match(detail, /dismissInteractionBlockers/);
    const loadEffect = detail.slice(
      detail.indexOf("resetRequestDetailTransientState({ setConfirmOverride, setError })"),
      detail.indexOf("setLoading(true)"),
    );
    assert.match(loadEffect, /dismissOverlays\(\)/);
    assert.doesNotMatch(loadEffect, /Keyboard\.dismiss/);
  });

  it("still dismisses keyboard on screen blur and successful actions", () => {
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /dismissInteractionBlockers\(\)/);
    assert.match(detail, /Keyboard\.dismiss/);
    assert.match(detail, /onSuccess: dismissInteractionBlockers/);
    assert.match(detail, /request-detail-blur/);
  });

  it("does not remount TextInputs on keyboard-driven layout via tab chrome deps", () => {
    const hooks = read("src/use-root-tab-bar.ts");
    assert.doesNotMatch(hooks, /insets\.bottom, navigation\]/);
    assert.match(hooks, /bottomInsetRef\.current/);
  });
});
