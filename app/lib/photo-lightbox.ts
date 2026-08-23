/**
 * Shared index and swipe math for photo viewers. Customer pages use a
 * progressive-enhancement script; the admin EXACT PLANTS table hydrates.
 */

export const PHOTO_LIGHTBOX_SWIPE_PX = 40;

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
  threshold = PHOTO_LIGHTBOX_SWIPE_PX,
): -1 | 0 | 1 {
  if (Math.abs(deltaX) < threshold) return 0;
  if (Math.abs(deltaX) < Math.abs(deltaY)) return 0;
  return deltaX > 0 ? -1 : 1;
}
