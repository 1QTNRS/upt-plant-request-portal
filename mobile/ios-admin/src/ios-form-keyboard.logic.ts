export type FormScrollKeyboardProps = {
  keyboardShouldPersistTaps: "always" | "never" | "handled";
  keyboardDismissMode?: "none" | "on-drag" | "interactive";
};

/**
 * Shared form keyboard props for admin ScrollViews.
 *
 * iOS uses `handled` + `none`, which is normal TextInput behavior:
 * a tap on a field focuses it, a tap on another field moves focus, and a tap
 * the scroll view does not give to a child dismisses the keyboard.
 *
 * `never` + `on-drag` was the previous rule. It is what made the first tap
 * fail. React Native 0.81 ScrollView (`_handleStartShouldSetResponderCapture`)
 * only eats a tap for `never` once a field is already focused and the keyboard
 * metrics exist. The flash the merchant sees — keyboard appears, then vanishes,
 * and the second tap sticks — happens after that focus:
 *
 * 1. Nothing is focused, so the scroll view does not capture the touch.
 * 2. The TextInput becomes first responder and the keyboard shows.
 * 3. UIKit scrolls the field into view (and KeyboardAvoidingView may pad).
 * 4. `keyboardDismissMode="on-drag"` is UIScrollViewKeyboardDismissModeOnDrag,
 *    so that reveal scroll resigns first responder and the keyboard hides.
 * 5. The field is already on screen, so the next tap does not scroll and stays.
 *
 * Drag-to-dismiss is the thing that resigns the field. It is not kept.
 */
export function iosFormScrollKeyboardPropsForPlatform(
  platformOs: string,
): FormScrollKeyboardProps {
  if (platformOs === "ios") {
    return {
      keyboardShouldPersistTaps: "handled",
      keyboardDismissMode: "none",
    };
  }
  return {
    keyboardShouldPersistTaps: "handled",
  };
}

export type KeyboardTapTarget = "text-input" | "other-control" | "empty";

/**
 * Mirrors ScrollView `_keyboardIsDismissible` (RN 0.81): a focused TextInput
 * and an already-open soft keyboard. The tap that first opens the keyboard
 * is not dismissible yet.
 */
export function keyboardIsDismissible(input: {
  hasFocusedTextInput: boolean;
  keyboardMetricsReady: boolean;
}): boolean {
  return input.hasFocusedTextInput && input.keyboardMetricsReady;
}

/**
 * Mirrors `_handleStartShouldSetResponderCapture` for `keyboardShouldPersistTaps`.
 * `true` means the scroll view eats the touch and the child never focuses.
 */
export function scrollViewCapturesTap(input: {
  keyboardShouldPersistTaps: FormScrollKeyboardProps["keyboardShouldPersistTaps"];
  keyboardDismissible: boolean;
  targetIsTextInput: boolean;
}): boolean {
  const neverPersists =
    !input.keyboardShouldPersistTaps || input.keyboardShouldPersistTaps === "never";
  return neverPersists && input.keyboardDismissible && !input.targetIsTextInput;
}

/**
 * UIScrollViewKeyboardDismissModeOnDrag / Interactive resigns first responder
 * when the scroll view moves, including the automatic reveal scroll on focus.
 */
export function revealScrollDismissesKeyboard(
  keyboardDismissMode: FormScrollKeyboardProps["keyboardDismissMode"],
  revealScrollDistance: number,
): boolean {
  if (revealScrollDistance === 0) return false;
  return keyboardDismissMode === "on-drag" || keyboardDismissMode === "interactive";
}

export type FocusOutcome = {
  focused: boolean;
  keyboardVisible: boolean;
  /** App code called Keyboard.dismiss. Native scroll dismiss is separate. */
  appDismissed: boolean;
  resignedByRevealScroll: boolean;
  capturedBeforeFocus: boolean;
};

/**
 * First tap on a TextInput while nothing is being edited.
 * `revealScrollDistance` is how far UIKit/KeyboardAvoidingView moves the
 * scroll view to bring that field above the keyboard. The first attempt
 * usually moves; the retry does not, which is why a second tap appeared to work.
 */
export function outcomeOfUnfocusedTextInputTap(
  platformOs: string,
  revealScrollDistance: number,
): FocusOutcome {
  const props = iosFormScrollKeyboardPropsForPlatform(platformOs);
  const capturedBeforeFocus = scrollViewCapturesTap({
    keyboardShouldPersistTaps: props.keyboardShouldPersistTaps,
    keyboardDismissible: keyboardIsDismissible({
      hasFocusedTextInput: false,
      keyboardMetricsReady: false,
    }),
    targetIsTextInput: true,
  });
  if (capturedBeforeFocus) {
    return {
      focused: false,
      keyboardVisible: false,
      appDismissed: false,
      resignedByRevealScroll: false,
      capturedBeforeFocus: true,
    };
  }
  const resignedByRevealScroll = revealScrollDismissesKeyboard(
    props.keyboardDismissMode,
    revealScrollDistance,
  );
  return {
    focused: !resignedByRevealScroll,
    keyboardVisible: !resignedByRevealScroll,
    appDismissed: false,
    resignedByRevealScroll,
    capturedBeforeFocus: false,
  };
}

/**
 * Input A is focused and the keyboard is up. A tap on Input B should focus B
 * on that same tap. `handled` delivers the touch to the TextInput. `never`
 * only steals the tap when the responder target is not a TextInput; a real
 * TextInput target is delivered, then a reveal scroll can still resign it.
 */
export function outcomeOfSwitchingTextInput(
  platformOs: string,
  input: { targetIsTextInput: boolean; revealScrollDistance: number },
): FocusOutcome & { focusedField: "A" | "B" | null } {
  const props = iosFormScrollKeyboardPropsForPlatform(platformOs);
  const captured = scrollViewCapturesTap({
    keyboardShouldPersistTaps: props.keyboardShouldPersistTaps,
    keyboardDismissible: true,
    targetIsTextInput: input.targetIsTextInput,
  });
  if (captured || !input.targetIsTextInput) {
    return {
      focused: false,
      focusedField: null,
      keyboardVisible: false,
      appDismissed: false,
      resignedByRevealScroll: false,
      capturedBeforeFocus: captured,
    };
  }
  const resignedByRevealScroll = revealScrollDismissesKeyboard(
    props.keyboardDismissMode,
    input.revealScrollDistance,
  );
  if (resignedByRevealScroll) {
    return {
      focused: false,
      focusedField: null,
      keyboardVisible: false,
      appDismissed: false,
      resignedByRevealScroll: true,
      capturedBeforeFocus: false,
    };
  }
  return {
    focused: true,
    focusedField: "B",
    keyboardVisible: true,
    appDismissed: false,
    resignedByRevealScroll: false,
    capturedBeforeFocus: false,
  };
}

/** An unhandled tap (empty scroll view) dismisses. A child that handles it does not. */
export function outsideTapDismissesKeyboard(
  platformOs: string,
  target: KeyboardTapTarget,
): boolean {
  const props = iosFormScrollKeyboardPropsForPlatform(platformOs);
  if (props.keyboardShouldPersistTaps === "always") return false;
  if (target === "text-input") return false;
  if (props.keyboardShouldPersistTaps === "handled" && target === "other-control") {
    return false;
  }
  return true;
}

export function typingPreservesFocus(keystrokes: string[]): boolean {
  return keystrokes.length > 0;
}

/** Debounced item saves must not run the success path that calls Keyboard.dismiss. */
export function backgroundAutosaveDismissesKeyboard(silentUi: boolean): boolean {
  return !silentUi;
}

export function onBlurFlushRuns(input: { blurred: boolean }): boolean {
  return input.blurred;
}

/**
 * Tab chrome is applied on focus. A keyboard-driven safe-area change must not
 * call setOptions again — that reflow was an earlier first-tap dismiss.
 */
export function tabChromeRefreshesFor(input: {
  isFocused: boolean;
  focusChanged: boolean;
  visibleChanged: boolean;
  swipeChanged: boolean;
  navigationChanged: boolean;
  safeAreaChanged: boolean;
}): boolean {
  if (!input.isFocused && !input.focusChanged) return false;
  if (
    input.safeAreaChanged &&
    !input.focusChanged &&
    !input.visibleChanged &&
    !input.swipeChanged &&
    !input.navigationChanged
  ) {
    return false;
  }
  return (
    input.focusChanged ||
    input.visibleChanged ||
    input.swipeChanged ||
    input.navigationChanged
  );
}

/** A closed stock dropdown does not claim an ordinary TextInput touch. */
export function stockSearchStealsOrdinaryTextInputTap(dropdownOpen: boolean): boolean {
  return dropdownOpen;
}
