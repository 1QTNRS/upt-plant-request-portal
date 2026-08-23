/**
 * Pure helpers for the customer photo lightbox. The storefront never hydrates,
 * so the viewer is a progressive-enhancement script; these keep index math and
 * swipe thresholds testable without a DOM.
 */

export const CUSTOMER_LIGHTBOX_SWIPE_PX = 40;

export function lightboxIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

/** -1 previous, 1 next, 0 ignore. Horizontal swipe must beat vertical. */
export function swipeNavigates(
  deltaX: number,
  deltaY: number,
  threshold = CUSTOMER_LIGHTBOX_SWIPE_PX,
): -1 | 0 | 1 {
  if (Math.abs(deltaX) < threshold) return 0;
  if (Math.abs(deltaX) < Math.abs(deltaY)) return 0;
  return deltaX > 0 ? -1 : 1;
}
