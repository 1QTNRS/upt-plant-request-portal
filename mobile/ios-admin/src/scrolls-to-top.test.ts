import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS scroll-to-top focus gating", () => {
  it("enables scrollsToTop only on focused primary scroll views", () => {
    const hook = read("src/use-primary-scroll.ts");
    assert.match(hook, /useIsFocused/);
    assert.match(hook, /scrollsToTop: isFocused/);
    const list = read("src/screens/RequestListScreen.tsx");
    assert.match(list, /usePrimaryScrollProps/);
    assert.match(list, /\{\.\.\.primaryScrollProps\}/);
    assert.match(read("src/screens/ExactPlantsScreen.tsx"), /usePrimaryScrollProps/);
    assert.match(read("src/screens/SettingsScreen.tsx"), /usePrimaryScrollProps/);
    assert.match(read("src/screens/RequestDetailScreen.tsx"), /usePrimaryScrollProps/);
    assert.match(read("src/screens/PropagationPlanningScreen.tsx"), /usePrimaryScrollProps/);
  });

  it("disables scrollsToTop on nested horizontal scroll views", () => {
    assert.match(read("src/components/PhotoStrip.tsx"), /scrollsToTop=\{false\}/);
    assert.match(read("src/components/ItemEditor.tsx"), /scrollsToTop=\{false\}/);
  });
});
