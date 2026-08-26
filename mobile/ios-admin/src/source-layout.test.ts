import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS admin source layout", () => {
  it("does not remount ItemEditor from inside App on each keystroke", () => {
    const app = read("App.tsx");
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /export function ItemEditor/);
    assert.doesNotMatch(app, /function ItemEditor/);
    assert.match(editor, /useState\(String\(item\.price/);
    assert.match(editor, /editable=\{fieldsOn\}/);
  });

  it("combines request counts with filters and pull-to-refresh", () => {
    const list = read("src/screens/RequestListScreen.tsx");
    assert.match(list, /StatusFilterBar/);
    assert.match(list, /DEFAULT_STATUS_FILTER/);
    assert.match(list, /RefreshControl/);
    assert.match(list, /filterRequestRows/);
    assert.doesNotMatch(list, /STATUS_FILTERS\.map/);
    assert.doesNotMatch(list, /stats\.newRequests/);
  });

  it("keeps stock results in an attached dropdown and compact photos", () => {
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /styles\.dropdown/);
    assert.match(editor, /STOCK_DROPDOWN_MAX_HEIGHT/);
    assert.match(editor, /styles\.thumbs/);
    assert.match(editor, /PhotoViewer/);
    assert.doesNotMatch(editor, /styles\.photo/);
    assert.doesNotMatch(editor, /height: 160/);
  });

  it("uses native stack swipe-back and a dark green tab bar", () => {
    const app = read("App.tsx");
    assert.match(app, /createNativeStackNavigator/);
    assert.match(app, /gestureEnabled: true/);
    assert.match(app, /fullScreenGestureEnabled: false/);
    assert.match(app, /backgroundColor: THEME\.darkGreen/);
    assert.match(app, /tabBarInactiveTintColor: THEME\.white/);
    assert.match(app, /insets\.bottom/);
  });
});
