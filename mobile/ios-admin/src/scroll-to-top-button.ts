/** Minimum downward scroll offset before showing the floating Top control. */
export const SCROLL_TO_TOP_SHOW_THRESHOLD = 120;

/** Hide the Top control when the user is within this distance of y=0. */
export const SCROLL_TO_TOP_HIDE_NEAR_TOP = 24;

export function scrollToTopButtonVisible(
  scrollY: number,
  threshold: number = SCROLL_TO_TOP_SHOW_THRESHOLD,
): boolean {
  if (!Number.isFinite(scrollY) || scrollY < 0) return false;
  if (scrollY <= SCROLL_TO_TOP_HIDE_NEAR_TOP) return false;
  return scrollY >= threshold;
}
