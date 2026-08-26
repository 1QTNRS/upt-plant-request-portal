export const MAIN_TABS = ["Requests", "ExactPlants", "Settings"] as const;

export type MainTabName = (typeof MAIN_TABS)[number];

export function adjacentMainTab(
  current: string,
  direction: "left" | "right",
): MainTabName | null {
  const index = MAIN_TABS.indexOf(current as MainTabName);
  if (index < 0) return null;
  const next = direction === "left" ? index + 1 : index - 1;
  return MAIN_TABS[next] ?? null;
}

export function tabSwipeEnabled(focusedRoute: string | undefined): boolean {
  return focusedRoute !== "RequestDetail" && focusedRoute !== "ExactPlantsReview";
}

export function swipeDirectionToAdjacent(
  current: string,
  translationX: number,
): MainTabName | null {
  if (Math.abs(translationX) < 40) return null;
  return adjacentMainTab(current, translationX < 0 ? "left" : "right");
}
