import { Platform } from "react-native";

import {
  iosFormScrollKeyboardPropsForPlatform,
  type FormScrollKeyboardProps,
} from "./ios-form-keyboard.logic";

export type { FormScrollKeyboardProps };

export function iosFormScrollKeyboardProps(): FormScrollKeyboardProps {
  return iosFormScrollKeyboardPropsForPlatform(Platform.OS);
}
