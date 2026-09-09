/** Whether the root material-top-tab pager may swipe between main tabs. */
export function tabSwipeEnabled(focusedRoute: string | undefined): boolean {
  return focusedRoute !== "RequestDetail" && focusedRoute !== "ExactPlantsReview";
}
