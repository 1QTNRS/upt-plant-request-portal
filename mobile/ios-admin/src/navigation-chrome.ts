import { TAB_BAR_CONTENT_HEIGHT } from "./item-editor";
import { THEME } from "./theme";

const DETAIL_ROUTES = new Set(["RequestDetail", "ExactPlantsReview"]);

export function rootTabBarVisible(focusedRouteName: string): boolean {
  return !DETAIL_ROUTES.has(focusedRouteName);
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
