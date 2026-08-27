export const PHOTO_VIEWER_ZOOM_PAN_THRESHOLD = 1.05;
export const PHOTO_VIEWER_MAX_ZOOM = 4;
export const PHOTO_VIEWER_DISMISS_DISTANCE = 80;
export const PHOTO_VIEWER_DISMISS_FLING_VELOCITY = 800;
export const PHOTO_VIEWER_DISMISS_FLING_DISTANCE = 24;
export const PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y = [-1000, 12] as const;
export const PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X = [-20, 20] as const;

/**
 * A clear one-finger downward swipe closes the viewer. Pinch-zoom, a zoomed
 * pan, or a mostly-horizontal photo change must not.
 */
export function shouldDismissPhotoViewer(input: {
  zoomScale: number;
  translationX: number;
  translationY: number;
  velocityY: number;
  numberActiveTouches?: number;
}): boolean {
  if ((input.numberActiveTouches ?? 1) > 1) return false;
  if (input.zoomScale > PHOTO_VIEWER_ZOOM_PAN_THRESHOLD) return false;
  if (Math.abs(input.translationX) >= Math.abs(input.translationY)) return false;
  if (input.translationY < 0) return false;
  if (input.translationY >= PHOTO_VIEWER_DISMISS_DISTANCE) return true;
  return (
    input.velocityY > PHOTO_VIEWER_DISMISS_FLING_VELOCITY &&
    input.translationY > PHOTO_VIEWER_DISMISS_FLING_DISTANCE
  );
}

export function photoViewerImagePanEnabled(zoomScale: number): boolean {
  return zoomScale > PHOTO_VIEWER_ZOOM_PAN_THRESHOLD;
}

export function photoViewerPagingEnabled(zoomScale: number): boolean {
  return !photoViewerImagePanEnabled(zoomScale);
}

export function photoViewerShouldPanImage(
  zoomScale: number,
  pointerCount: number,
): boolean {
  return pointerCount === 1 && photoViewerImagePanEnabled(zoomScale);
}

export type PhotoViewerImageTransform = {
  scale: number;
  translateX: number;
  translateY: number;
};

/**
 * At base zoom the photo is always identity. Leftover pan from a prior
 * pinch — the half-screen offset that stuck the image in a corner after
 * close/reopen — must not render.
 */
export function photoViewerImageTransform(
  scale: number,
  translateX: number,
  translateY: number,
): PhotoViewerImageTransform {
  const nextScale = clampPhotoViewerZoom(scale);
  if (!photoViewerImagePanEnabled(nextScale)) {
    return resetPhotoViewerImageTransform();
  }
  return {
    scale: nextScale,
    translateX: Number.isFinite(translateX) ? translateX : 0,
    translateY: Number.isFinite(translateY) ? translateY : 0,
  };
}

export function resetPhotoViewerImageTransform(): PhotoViewerImageTransform {
  return { scale: 1, translateX: 0, translateY: 0 };
}

export function clampPhotoViewerZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(PHOTO_VIEWER_MAX_ZOOM, Math.max(1, scale));
}

export function shouldCapturePhotoViewerDismiss(
  zoomScale: number,
  translationX: number,
  translationY: number,
  numberActiveTouches = 1,
): boolean {
  if (numberActiveTouches > 1) return false;
  if (photoViewerImagePanEnabled(zoomScale)) return false;
  return translationY > 12 && Math.abs(translationY) > Math.abs(translationX) * 1.25;
}

/**
 * One sheet: photo and backdrop share this fade so they do not recede at
 * different rates while the viewer translates.
 */
export function photoViewerSheetOpacity(
  translationY: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 1;
  return Math.max(0, 1 - Math.max(0, translationY) / viewportHeight);
}

export function photoViewerDismissTranslateY(translationY: number): number {
  return Math.max(0, translationY);
}

/**
 * Gesture Handler reports px/s. React Native PanResponder `vy` is typically
 * px/ms. Normalize so the dismiss threshold stays 800.
 */
export function normalizedSwipeVelocity(velocityY: number): number {
  return Math.abs(velocityY) > 20 ? velocityY : velocityY * 1000;
}
