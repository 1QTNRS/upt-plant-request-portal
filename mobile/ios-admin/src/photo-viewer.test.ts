import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PHOTO_VIEWER_ZOOM_PAN_THRESHOLD,
  photoViewerBounces,
  photoViewerDismissTranslateY,
  photoViewerScrollEnabled,
  photoViewerSheetOpacity,
  shouldCapturePhotoViewerDismiss,
  shouldDismissPhotoViewer,
} from "./photo-viewer";

describe("photo viewer swipe-down dismiss", () => {
  it("closes on a clear downward swipe at normal zoom", () => {
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 1,
        translationX: 8,
        translationY: 90,
        velocityY: 200,
      }),
      true,
    );
  });

  it("closes on a downward fling that has not yet travelled far", () => {
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 1,
        translationX: 4,
        translationY: 30,
        velocityY: 900,
      }),
      true,
    );
  });

  it("does not close on a horizontal photo swipe", () => {
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 1,
        translationX: 120,
        translationY: 20,
        velocityY: 400,
      }),
      false,
    );
    assert.equal(shouldCapturePhotoViewerDismiss(1, 120, 20), false);
  });

  it("does not close while pinch-zooming or while zoomed in", () => {
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 1,
        translationX: 0,
        translationY: 100,
        velocityY: 200,
        numberActiveTouches: 2,
      }),
      false,
    );
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 2,
        translationX: 0,
        translationY: 120,
        velocityY: 900,
      }),
      false,
    );
    assert.equal(shouldCapturePhotoViewerDismiss(2, 0, 120), false);
    assert.equal(shouldCapturePhotoViewerDismiss(1, 0, 80, 2), false);
  });

  it("does not take a short downward swipe as a dismiss", () => {
    assert.equal(
      shouldDismissPhotoViewer({
        zoomScale: 1,
        translationX: 4,
        translationY: 40,
        velocityY: 200,
      }),
      false,
    );
  });

  it("locks the zoom scroll view at base zoom and unlocks it when zoomed", () => {
    assert.equal(photoViewerScrollEnabled(1), false);
    assert.equal(photoViewerBounces(1), false);
    assert.equal(photoViewerScrollEnabled(PHOTO_VIEWER_ZOOM_PAN_THRESHOLD), false);
    assert.equal(photoViewerBounces(PHOTO_VIEWER_ZOOM_PAN_THRESHOLD), false);
    assert.equal(photoViewerScrollEnabled(1.2), true);
    assert.equal(photoViewerBounces(1.2), true);
  });

  it("keeps photo and backdrop on one fade curve while the sheet translates", () => {
    assert.equal(photoViewerSheetOpacity(0, 800), 1);
    assert.equal(photoViewerSheetOpacity(200, 800), 0.75);
    assert.equal(photoViewerSheetOpacity(800, 800), 0);
    assert.equal(photoViewerDismissTranslateY(-40), 0);
    assert.equal(photoViewerDismissTranslateY(90), 90);
  });

  it("owns vertical dismiss before the zoom scroll view can rubber-band", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoViewer.tsx"),
      "utf8",
    );
    assert.match(source, /shouldDismissPhotoViewer/);
    assert.match(source, /shouldCapturePhotoViewerDismiss/);
    assert.match(source, /onMoveShouldSetPanResponderCapture/);
    assert.match(source, /onPanResponderTerminationRequest: \(\) => false/);
    assert.match(source, /onShouldBlockNativeResponder: \(\) => true/);
    assert.match(source, /photoViewerDismissTranslateY/);
    assert.match(source, /photoViewerScrollEnabled/);
    assert.match(source, /photoViewerBounces/);
    assert.match(source, /bouncesZoom=\{photoViewerBounces/);
    assert.match(source, /scrollEnabled=\{photoViewerScrollEnabled/);
    assert.match(source, /bounces=\{photoViewerBounces/);
    assert.match(source, /Animated\.spring/);
    assert.match(source, /opacity: sheetOpacity/);
    assert.match(source, /transform: \[\{ translateY: dragY \}\]/);
    assert.match(source, /inputRange: \[0, SCREEN_HEIGHT\]/);
    assert.equal((source.match(/PanResponder\.create/g) || []).length, 1);
    assert.doesNotMatch(source, /Gesture\.Pan/);
    assert.match(source, />Close</);
    assert.match(source, /onPress=\{onClose\}/);
    assert.match(source, /pagingEnabled/);
    assert.match(source, /directionalLockEnabled/);
    assert.match(source, /maximumZoomScale=\{4\}/);
  });
});
