export type FormScrollKeyboardProps = {
  keyboardShouldPersistTaps: "always" | "never" | "handled";
  keyboardDismissMode?: "none" | "on-drag" | "interactive";
};

/**
 * Shared iOS form keyboard rule for admin screens.
 *
 * When a TextInput is focused, taps outside it dismiss the keyboard and are
 * not delivered to children — including another TextInput, a button, or empty
 * space. A second tap then focuses the new target normally.
 *
 * React Native implements this with keyboardShouldPersistTaps="never".
 * Android keeps "handled" so controls remain tappable while the keyboard is up.
 */
export function iosFormScrollKeyboardPropsForPlatform(
  platformOs: string,
): FormScrollKeyboardProps {
  if (platformOs === "ios") {
    return {
      keyboardShouldPersistTaps: "never",
      keyboardDismissMode: "on-drag",
    };
  }
  return {
    keyboardShouldPersistTaps: "handled",
  };
}
