import { useIsFocused } from "@react-navigation/native";
import { useMemo } from "react";

import { iosFormScrollKeyboardProps } from "./ios-form-keyboard";

/** Primary screen ScrollView: keyboard props + iOS status-bar scroll-to-top when focused. */
export function usePrimaryScrollProps() {
  const isFocused = useIsFocused();
  return useMemo(
    () => ({
      ...iosFormScrollKeyboardProps(),
      scrollsToTop: isFocused,
    }),
    [isFocused],
  );
}
