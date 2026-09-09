import type { StyleProp, ViewStyle } from "react-native";

import { TAB_BAR_CONTENT_HEIGHT, TAB_BAR_LABEL_FONT_SIZE } from "./item-editor";
import { THEME } from "./theme";

const DETAIL_ROUTES = new Set(["RequestDetail", "ExactPlantsReview"]);

export function rootTabBarVisible(focusedRouteName: string): boolean {
  return !DETAIL_ROUTES.has(focusedRouteName);
}

/** Bottom tabs default to a triangle MissingIcon when tabBarIcon is omitted. */
export function rootTabBarLabelOnlyOptions(bottomInset: number) {
  return {
    tabBarIcon: () => null,
    tabBarIconStyle: {
      display: "none" as const,
      width: 0,
      height: 0,
    } satisfies StyleProp<ViewStyle>,
    tabBarShowLabel: true,
    tabBarActiveTintColor: THEME.yellow,
    tabBarInactiveTintColor: THEME.white,
    tabBarLabelStyle: {
      fontWeight: "700" as const,
      fontSize: TAB_BAR_LABEL_FONT_SIZE,
      marginBottom: 0,
    },
    tabBarStyle: rootTabBarStyle({ visible: true, bottomInset }),
    tabBarHideOnKeyboard: true,
  };
}

export function rootTabBarStyle(input: {
  visible: boolean;
  bottomInset: number;
}) {
  const fullHeight = TAB_BAR_CONTENT_HEIGHT + input.bottomInset;
  if (input.visible) {
    return {
      backgroundColor: THEME.darkGreen,
      borderTopColor: THEME.darkGreen,
      height: fullHeight,
      paddingTop: 12,
      paddingBottom: input.bottomInset + 10,
      opacity: 1,
      pointerEvents: "auto" as const,
    };
  }
  return {
    backgroundColor: THEME.darkGreen,
    borderTopColor: THEME.darkGreen,
    height: 0,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    overflow: "hidden" as const,
    opacity: 0,
    pointerEvents: "none" as const,
  };
}
