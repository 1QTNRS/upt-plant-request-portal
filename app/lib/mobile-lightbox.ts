/**
 * Mobile browser lightbox helpers: scroll lock, pinch zoom, gallery swipe, dismiss.
 * Used by admin (React) and customer (progressive-enhancement script).
 */

export const LIGHTBOX_DISMISS_PX = 80;
export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 4;
export const LIGHTBOX_BASE_SCALE_EPSILON = 0.01;

export function isBaseScale(scale: number): boolean {
  return scale <= LIGHTBOX_MIN_SCALE + LIGHTBOX_BASE_SCALE_EPSILON;
}

export function clampLightboxScale(scale: number): number {
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale));
}

export function pinchScale(
  distance: number,
  startDistance: number,
  startScale: number,
): number {
  if (startDistance <= 0) return startScale;
  return clampLightboxScale(startScale * (distance / startDistance));
}

export function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Client coordinates for one touch/pointer contact. */
export type TouchLike = { clientX: number; clientY: number };

/** Distance between the first two contacts (iOS Safari pinch uses Touch events). */
export function touchPairDistance(first: TouchLike, second: TouchLike): number {
  return pointerDistance(
    { x: first.clientX, y: first.clientY },
    { x: second.clientX, y: second.clientY },
  );
}

export function pinchScaleFromTouches(
  first: TouchLike,
  second: TouchLike,
  startDistance: number,
  startScale: number,
): number {
  return pinchScale(touchPairDistance(first, second), startDistance, startScale);
}

/** Non-passive options required so iOS Safari allows preventDefault on pinch. */
export const LIGHTBOX_TOUCH_LISTENER_OPTIONS: AddEventListenerOptions = {
  passive: false,
};

/** Downward drag at base scale — true when drag exceeds threshold. */
export function dismissSwipe(deltaY: number, threshold = LIGHTBOX_DISMISS_PX): boolean {
  return deltaY > threshold;
}

/** Horizontal gallery navigation only at base scale and when multiple images exist. */
export function gallerySwipe(
  deltaX: number,
  deltaY: number,
  imageCount: number,
  scale: number,
  threshold = 40,
): -1 | 0 | 1 {
  if (imageCount <= 1 || !isBaseScale(scale)) return 0;
  if (Math.abs(deltaX) < threshold) return 0;
  if (Math.abs(deltaX) < Math.abs(deltaY)) return 0;
  return deltaX > 0 ? -1 : 1;
}

export type PageScrollLock = {
  unlock: () => void;
  scrollY: number;
};

/** Lock background scroll; returns unlock that restores position. */
export function lockPageScroll(doc: Document = document): PageScrollLock | null {
  if (typeof doc === "undefined" || !doc.body) return null;
  const scrollY = doc.defaultView?.scrollY ?? 0;
  const body = doc.body;
  const html = doc.documentElement;
  const prev = {
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    htmlOverflow: html.style.overflow,
  };
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.width = "100%";
  html.style.overflow = "hidden";
  return {
    scrollY,
    unlock: () => {
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.width = prev.bodyWidth;
      html.style.overflow = prev.htmlOverflow;
      doc.defaultView?.scrollTo(0, scrollY);
    },
  };
}

export const MOBILE_LIGHTBOX_STAGE_CSS = `
  [data-lightbox-stage] {
    touch-action: none;
    overscroll-behavior: none;
  }
  [data-lightbox-transform] {
    will-change: transform;
    transform-origin: center center;
  }
  [data-admin-photo-lightbox],
  [data-customer-lightbox] {
    overscroll-behavior: none;
    touch-action: none;
  }
`;
