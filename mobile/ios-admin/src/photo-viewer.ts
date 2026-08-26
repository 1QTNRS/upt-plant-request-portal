export const PHOTO_VIEWER_ZOOM_PAN_THRESHOLD = 1.05;
export const PHOTO_VIEWER_DISMISS_DISTANCE = 80;
export const PHOTO_VIEWER_DISMISS_FLING_VELOCITY = 800;
export const PHOTO_VIEWER_DISMISS_FLING_DISTANCE = 24;

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

export function shouldCapturePhotoViewerDismiss(
  zoomScale: number,
  translationX: number,
  translationY: number,
  numberActiveTouches = 1,
): boolean {
  if (numberActiveTouches > 1) return false;
  if (zoomScale > PHOTO_VIEWER_ZOOM_PAN_THRESHOLD) return false;
  return translationY > 12 && Math.abs(translationY) > Math.abs(translationX) * 1.25;
}

/**
 * React Native's PanResponder `vy` is typically px/ms (fractions). Some
 * builds already report px/s. Normalize so the dismiss threshold stays 800.
 */
export function normalizedSwipeVelocity(velocityY: number): number {
  return Math.abs(velocityY) > 20 ? velocityY : velocityY * 1000;
}
