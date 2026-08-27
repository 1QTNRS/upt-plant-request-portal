import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { THEME } from "./theme";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("request page mint chrome", () => {
  it("uses #d6ece2 for request page chrome and keeps cards white", () => {
    assert.equal(THEME.mint, "#d6ece2");
    assert.equal(THEME.requestPage, "#d6ece2");
    assert.equal(THEME.requestPage, THEME.mint);
    assert.equal(THEME.white, "#ffffff");
    assert.equal(THEME.darkGreen, "#002910");
    assert.equal(THEME.yellow, "#f1a638");

    const ui = read("src/ui.ts");
    assert.match(ui, /flexPage: \{ flex: 1, backgroundColor: THEME\.requestPage \}/);
    assert.match(ui, /screen: \{ flex: 1, padding: 16, backgroundColor: THEME\.requestPage \}/);
    assert.match(ui, /page: \{ padding: 16, gap: 12, backgroundColor: THEME\.requestPage \}/);
    assert.match(ui, /card: \{[\s\S]*backgroundColor: THEME\.white/);
    assert.match(ui, /input: \{[\s\S]*backgroundColor: THEME\.white/);
  });

  it("paints the list, detail, and navigator chrome mint without restyling the tab bar", () => {
    const app = read("App.tsx");
    const list = read("src/screens/RequestListScreen.tsx");
    const detail = read("src/screens/RequestDetailScreen.tsx");
    const editor = read("src/components/ItemEditor.tsx");

    assert.match(app, /contentStyle: \{ backgroundColor: THEME\.requestPage \}/);
    assert.match(app, /sceneStyle: \{ backgroundColor: THEME\.requestPage \}/);
    assert.match(app, /theme=\{signedInTheme\}/);
    assert.match(app, /background: THEME\.requestPage/);
    assert.match(app, /signedInChrome \? THEME\.requestPage : APP_INTRO_BACKGROUND/);
    assert.match(app, /backgroundColor: THEME\.darkGreen/);
    assert.match(app, /tabBarActiveTintColor: THEME\.yellow/);
    assert.match(app, /tabBarInactiveTintColor: THEME\.white/);

    assert.match(list, /style=\{ui\.screen\}/);
    assert.match(list, /style=\{ui\.flexPage\}/);
    assert.match(list, /progressBackgroundColor=\{THEME\.requestPage\}/);
    assert.match(list, /tintColor=\{THEME\.darkGreen\}/);

    assert.match(detail, /style=\{ui\.flexPage\}/);
    assert.match(detail, /contentContainerStyle=\{ui\.page\}/);
    assert.doesNotMatch(detail, /SafeAreaView style=\{ui\.flex\}/);

    assert.match(editor, /style=\{ui\.card\}/);
    assert.doesNotMatch(editor, /backgroundColor: THEME\.requestPage/);
  });

  it("keeps New status readable on the mint page", () => {
    const pills = read("src/StatusPills.tsx");
    assert.match(pills, /backgroundColor: THEME\.white/);
    assert.match(pills, /borderColor: THEME\.line/);
    assert.doesNotMatch(
      pills,
      /return \{ backgroundColor: THEME\.mint, color: THEME\.darkGreen, borderColor: THEME\.mint \}/,
    );
  });
});
