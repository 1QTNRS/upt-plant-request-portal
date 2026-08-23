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

/** Small side arrows. Hidden on a narrow screen so swipe can use the photo. */
export const LIGHTBOX_NAV_CSS = `
  .lightbox-nav {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 36px;
    height: 36px;
    min-width: 36px;
    min-height: 36px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid #8c9196;
    background: #202223;
    color: #fff;
    font: 28px/1 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
    z-index: 2;
  }
  [data-lightbox-image] {
    max-width: min(80vw, 860px);
    max-height: 78vh;
    object-fit: contain;
  }
  @media (max-width: 720px) {
    .lightbox-nav { display: none !important; }
    [data-lightbox-image] { max-width: min(96vw, 900px); }
  }
`;

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
