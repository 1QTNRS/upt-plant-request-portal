import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  explicitActionDismissesKeyboard,
  fieldSaveDismissesKeyboard,
  iosFormScrollKeyboardPropsForPlatform,
  keyboardDismissAllowed,
  keyboardIsDismissible,
  onBlurFlushRuns,
  outcomeOfSwitchingTextInput,
  outcomeOfUnfocusedTextInputTap,
  outsideTapDismissesKeyboard,
  revealScrollDismissesKeyboard,
  scrollViewCapturesTap,
  simulateMoveFromFieldAToFieldB,
  stockSearchStealsOrdinaryTextInputTap,
  tabChromeRefreshesFor,
  typingPreservesFocus,
} from "./ios-form-keyboard.logic";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("first tap on an unfocused TextInput", () => {
  it("stays focused when the keyboard reveal scroll would previously resign it", () => {
    const first = outcomeOfUnfocusedTextInputTap("ios", 180);
    assert.equal(first.capturedBeforeFocus, false);
    assert.equal(first.resignedByRevealScroll, false);
    assert.equal(first.appDismissed, false);
    assert.equal(first.focused, true);
    assert.equal(first.keyboardVisible, true);
  });

  it("does not need a second tap once the field is already on screen", () => {
    const again = outcomeOfUnfocusedTextInputTap("ios", 0);
    assert.equal(again.focused, true);
    assert.equal(again.keyboardVisible, true);
    assert.equal(again.resignedByRevealScroll, false);
  });

  it("records the old on-drag rule as the resign, so the regression is explicit", () => {
    assert.equal(revealScrollDismissesKeyboard("on-drag", 180), true);
    assert.equal(revealScrollDismissesKeyboard("interactive", 180), true);
    assert.equal(revealScrollDismissesKeyboard("none", 180), false);
    assert.equal(revealScrollDismissesKeyboard("on-drag", 0), false);
    assert.equal(
      keyboardIsDismissible({ hasFocusedTextInput: false, keyboardMetricsReady: false }),
      false,
    );
    assert.equal(
      scrollViewCapturesTap({
        keyboardShouldPersistTaps: "never",
        keyboardDismissible: false,
        targetIsTextInput: true,
      }),
      false,
    );
  });
});

describe("moving between fields and typing", () => {
  it("focuses Input B on the same tap that leaves Input A", () => {
    const moved = outcomeOfSwitchingTextInput("ios", {
      targetIsTextInput: true,
      revealScrollDistance: 40,
    });
    assert.equal(moved.focusedField, "B");
    assert.equal(moved.keyboardVisible, true);
    assert.equal(moved.capturedBeforeFocus, false);
    assert.equal(moved.resignedByRevealScroll, false);
  });

  it("keeps focus across repeated onChangeText updates", () => {
    assert.equal(typingPreservesFocus(["P", "Ph", "Phi"]), true);
    const props = iosFormScrollKeyboardPropsForPlatform("ios");
    assert.equal(props.keyboardShouldPersistTaps, "handled");
    assert.equal(props.keyboardDismissMode, "none");
  });

  it("does not run the blur flush unless a real blur happened", () => {
    assert.equal(onBlurFlushRuns({ blurred: false }), false);
    assert.equal(onBlurFlushRuns({ blurred: true }), true);
  });

  it("dismisses on empty space and leaves a handled control alone", () => {
    assert.equal(outsideTapDismissesKeyboard("ios", "empty"), true);
    assert.equal(outsideTapDismissesKeyboard("ios", "text-input"), false);
    assert.equal(outsideTapDismissesKeyboard("ios", "other-control"), false);
  });

  it("stays stable across focus, blur, and focus again", () => {
    const first = outcomeOfUnfocusedTextInputTap("ios", 120);
    assert.equal(first.focused, true);
    assert.equal(onBlurFlushRuns({ blurred: true }), true);
    const second = outcomeOfUnfocusedTextInputTap("ios", 0);
    assert.equal(second.focused, true);
    assert.equal(second.keyboardVisible, true);
    const third = outcomeOfSwitchingTextInput("ios", {
      targetIsTextInput: true,
      revealScrollDistance: 0,
    });
    assert.equal(third.focusedField, "B");
  });
});

describe("moving from one field to the next", () => {
  it("keeps B's keyboard up when A's blur-save returns", () => {
    const kept = simulateMoveFromFieldAToFieldB({ blurSaveForwardsResult: false });
    assert.equal(kept.focusedField, "B");
    assert.equal(kept.keyboardVisible, true);
    assert.equal(kept.dismissedBy, null);
    assert.equal(kept.blurSavePersisted, true);
    assert.ok(kept.sequence.includes("B onFocus"));
    assert.ok(kept.sequence.includes("skip onResult"));
    assert.ok(kept.sequence.indexOf("B onFocus") < kept.sequence.indexOf("blur-save returns"));

    const broken = simulateMoveFromFieldAToFieldB({ blurSaveForwardsResult: true });
    assert.equal(broken.keyboardVisible, false);
    assert.equal(broken.dismissedBy, "Keyboard.dismiss");
    assert.ok(broken.sequence.includes("dismissInteractionBlockers"));
  });

  it("does not dismiss for autosave or blur flush, and still dismisses explicit actions", () => {
    assert.equal(fieldSaveDismissesKeyboard("autosave"), false);
    assert.equal(fieldSaveDismissesKeyboard("blur-flush"), false);
    assert.equal(explicitActionDismissesKeyboard(), true);
    assert.equal(keyboardDismissAllowed("screen-blur"), true);
    assert.equal(keyboardDismissAllowed("screen-unmount"), true);
    assert.equal(keyboardDismissAllowed("stock-search-outside"), true);
    assert.equal(keyboardDismissAllowed("field-autosave"), false);
    assert.equal(keyboardDismissAllowed("field-blur-save"), false);

    const editor = read("src/components/ItemEditor.tsx");
    const persist = editor.slice(
      editor.indexOf("async function persistDraft"),
      editor.indexOf("persistDraftRef.current = persistDraft"),
    );
    assert.match(persist, /skipResult: true/);
    assert.doesNotMatch(persist, /skipResult: options\?\.silentUi/);
    assert.match(editor, /onBlur=\{\(\) => void persistDraftRef\.current\(\{ flush: true \}\)\}/);
    assert.match(editor, /persistDraftRef\.current\(\{ silentUi: true \}\)/);

    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /onSuccess: dismissInteractionBlockers/);
    assert.equal(detail.split("Keyboard.dismiss()").length - 1, 2);
  });
});

describe("saves, chrome, and stock search do not steal focus", () => {
  it("background autosave and blur flush both skip the parent dismiss", () => {
    assert.equal(fieldSaveDismissesKeyboard("autosave"), false);
    assert.equal(fieldSaveDismissesKeyboard("blur-flush"), false);
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /persistDraftRef\.current\(\{ silentUi: true \}\)/);
  });

  it("a keyboard safe-area change does not refresh tab chrome", () => {
    assert.equal(
      tabChromeRefreshesFor({
        isFocused: true,
        focusChanged: false,
        visibleChanged: false,
        swipeChanged: false,
        navigationChanged: false,
        safeAreaChanged: true,
      }),
      false,
    );
    assert.equal(
      tabChromeRefreshesFor({
        isFocused: true,
        focusChanged: true,
        visibleChanged: false,
        swipeChanged: false,
        navigationChanged: false,
        safeAreaChanged: true,
      }),
      true,
    );
  });

  it("a closed stock search does not take an ordinary TextInput tap", () => {
    assert.equal(stockSearchStealsOrdinaryTextInputTap(false), false);
    assert.equal(stockSearchStealsOrdinaryTextInputTap(true), true);
  });
});

describe("shared props on every editable admin screen", () => {
  it("iOS no longer uses the two-tap never/on-drag rule", () => {
    const props = iosFormScrollKeyboardPropsForPlatform("ios");
    assert.equal(props.keyboardShouldPersistTaps, "handled");
    assert.equal(props.keyboardDismissMode, "none");
    assert.doesNotMatch(read("src/ios-form-keyboard.logic.ts"), /keyboardShouldPersistTaps: "never"/);
    assert.doesNotMatch(read("src/ios-form-keyboard.logic.ts"), /keyboardDismissMode: "on-drag"/);
  });

  it("spreads the shared helper instead of a per-screen taps override", () => {
    for (const screen of [
      "src/screens/RequestDetailScreen.tsx",
      "src/screens/SettingsScreen.tsx",
      "src/screens/LoginScreen.tsx",
      "src/screens/ExactPlantsScreen.tsx",
      "src/screens/RequestListScreen.tsx",
      "src/screens/PropagationPlanningScreen.tsx",
    ]) {
      const source = read(screen);
      assert.match(
        source,
        /iosFormScrollKeyboardProps\(\)|usePrimaryScrollProps/,
        screen,
      );
      assert.doesNotMatch(source, /keyboardShouldPersistTaps="/, screen);
      assert.doesNotMatch(source, /keyboardDismissMode="/, screen);
    }
  });

  it("stock search dropdown keeps always so result rows stay tappable", () => {
    assert.match(read("src/components/ItemEditor.tsx"), /keyboardShouldPersistTaps="always"/);
    assert.match(read("src/components/ItemEditor.tsx"), /keyboardDismissMode="none"/);
  });

  it("Android keeps handled so controls stay tappable while the keyboard is up", () => {
    assert.equal(
      iosFormScrollKeyboardPropsForPlatform("android").keyboardShouldPersistTaps,
      "handled",
    );
  });
});
