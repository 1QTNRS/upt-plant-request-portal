import { TAB_BAR_CONTENT_HEIGHT, TAB_BAR_LABEL_FONT_SIZE } from "./item-editor";
import { THEME } from "./theme";

const DETAIL_ROUTES = new Set(["RequestDetail", "ExactPlantsReview"]);

export function rootTabBarVisible(focusedRouteName: string): boolean {
  return !DETAIL_ROUTES.has(focusedRouteName);
}

/** Label-only bottom tab bar for the material-top-tab pager (no indicator icons). */
export function rootMaterialTabScreenOptions(
  bottomInset: number,
  swipeEnabled: boolean,
) {
  return {
    lazy: false,
    swipeEnabled,
    tabBarActiveTintColor: THEME.yellow,
    tabBarInactiveTintColor: THEME.white,
    tabBarLabelStyle: {
      fontWeight: "700" as const,
      fontSize: TAB_BAR_LABEL_FONT_SIZE,
      marginBottom: 0,
      textTransform: "none" as const,
    },
    tabBarItemStyle: { justifyContent: "center" as const, paddingVertical: 6 },
    tabBarIndicatorStyle: { height: 0, backgroundColor: "transparent" },
    tabBarPressColor: "transparent",
    tabBarBounces: false,
    tabBarStyle: rootTabBarStyle({ visible: true, bottomInset }),
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
