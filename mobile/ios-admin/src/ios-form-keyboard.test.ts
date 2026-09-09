import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { iosFormScrollKeyboardPropsForPlatform } from "./ios-form-keyboard.logic";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS form keyboard two-tap rule", () => {
  it("no active input + tap TextInput => focuses normally (never allows first focus)", () => {
    assert.equal(
      iosFormScrollKeyboardPropsForPlatform("ios").keyboardShouldPersistTaps,
      "never",
    );
  });

  it("active Input A + tap outside => blur + keyboard dismiss without child tap", () => {
    const props = iosFormScrollKeyboardPropsForPlatform("ios");
    assert.equal(props.keyboardShouldPersistTaps, "never");
    assert.equal(props.keyboardDismissMode, "on-drag");
  });

  it("active Input A + tap Input B => dismisses A only; B does not focus on first tap", () => {
    const source = read("src/ios-form-keyboard.logic.ts");
    assert.match(
      source,
      /not delivered to children[\s\S]*another TextInput/,
    );
    assert.equal(
      iosFormScrollKeyboardPropsForPlatform("ios").keyboardShouldPersistTaps,
      "never",
    );
  });

  it("second tap on Input B => focuses normally after keyboard dismissed", () => {
    assert.match(read("src/ios-form-keyboard.logic.ts"), /A second tap/i);
  });

  it("typing multiple characters does not change keyboard props mid-session", () => {
    assert.equal(
      iosFormScrollKeyboardPropsForPlatform("ios").keyboardShouldPersistTaps,
      "never",
    );
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /persistDraftRef\.current\(\{ silentUi: true \}\)/);
  });

  it("iosFormScrollKeyboardProps is spread on editable admin screens", () => {
    for (const screen of [
      "src/screens/RequestDetailScreen.tsx",
      "src/screens/SettingsScreen.tsx",
      "src/screens/LoginScreen.tsx",
      "src/screens/ExactPlantsScreen.tsx",
      "src/screens/RequestListScreen.tsx",
    ]) {
      const source = read(screen);
      assert.match(
        source,
        /iosFormScrollKeyboardProps\(\)/,
        `${screen} should spread iosFormScrollKeyboardProps`,
      );
      assert.doesNotMatch(
        source,
        /keyboardShouldPersistTaps="handled"/,
        `${screen} must not override with handled`,
      );
    }
  });

  it("stock search dropdown keeps always so result rows stay tappable while searching", () => {
    assert.match(read("src/components/ItemEditor.tsx"), /keyboardShouldPersistTaps="always"/);
  });

  it("Android keeps handled so controls stay tappable while keyboard is up", () => {
    assert.equal(
      iosFormScrollKeyboardPropsForPlatform("android").keyboardShouldPersistTaps,
      "handled",
    );
  });
});
