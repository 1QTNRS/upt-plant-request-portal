import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y,
  PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X,
  PHOTO_VIEWER_MAX_ZOOM,
  PHOTO_VIEWER_ZOOM_PAN_THRESHOLD,
  clampPhotoViewerZoom,
  photoViewerDismissTranslateY,
  photoViewerImagePanEnabled,
  photoViewerImageTransform,
  photoViewerPagingEnabled,
  photoViewerSheetOpacity,
  photoViewerShouldPanImage,
  resetPhotoViewerImageTransform,
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
    assert.equal(photoViewerPagingEnabled(1), true);
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
    assert.equal(photoViewerImagePanEnabled(2), true);
    assert.equal(photoViewerPagingEnabled(2), false);
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

  it("pages at base zoom and pans the image only when zoomed", () => {
    assert.equal(photoViewerPagingEnabled(1), true);
    assert.equal(photoViewerImagePanEnabled(1), false);
    assert.equal(photoViewerPagingEnabled(PHOTO_VIEWER_ZOOM_PAN_THRESHOLD), true);
    assert.equal(photoViewerImagePanEnabled(1.2), true);
    assert.equal(photoViewerShouldPanImage(2, 1), true);
    assert.equal(photoViewerShouldPanImage(2, 2), false);
    assert.equal(photoViewerShouldPanImage(1, 1), false);
    assert.equal(clampPhotoViewerZoom(0.4), 1);
    assert.equal(clampPhotoViewerZoom(9), PHOTO_VIEWER_MAX_ZOOM);
  });

  it("drops leftover pan at base zoom so a reopen cannot sit in a corner", () => {
    assert.deepEqual(resetPhotoViewerImageTransform(), {
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    assert.deepEqual(photoViewerImageTransform(1, 210, 400), {
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    assert.deepEqual(photoViewerImageTransform(1.02, 80, 90), {
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    assert.deepEqual(photoViewerImageTransform(2, 40, -20), {
      scale: 2,
      translateX: 40,
      translateY: -20,
    });
  });

  it("keeps photo and backdrop on one fade curve while the sheet translates", () => {
    assert.equal(photoViewerSheetOpacity(0, 800), 1);
    assert.equal(photoViewerSheetOpacity(200, 800), 0.75);
    assert.equal(photoViewerSheetOpacity(800, 800), 0);
    assert.equal(photoViewerDismissTranslateY(-40), 0);
    assert.equal(photoViewerDismissTranslateY(90), 90);
  });

  it("uses one Gesture Handler owner and does not keep a zoom ScrollView", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoViewer.tsx"),
      "utf8",
    );
    assert.match(source, /GestureHandlerRootView/);
    assert.match(source, /Gesture\.Pan/);
    assert.match(source, /Gesture\.Pinch/);
    assert.match(source, /Gesture\.Simultaneous/);
    assert.match(source, /failOffsetX/);
    assert.match(source, /activeOffsetY/);
    assert.match(source, /PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X/);
    assert.match(source, /PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y/);
    assert.deepEqual([...PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X], [-20, 20]);
    assert.deepEqual([...PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y], [-1000, 12]);
    assert.match(source, /shouldDismissPhotoViewer/);
    assert.match(source, /photoViewerPagingEnabled/);
    assert.match(source, /photoViewerShouldPanImage/);
    assert.match(source, /scrollEnabled=\{pagingEnabled\}/);
    assert.match(source, /Animated\.spring/);
    assert.match(source, /opacity: sheetOpacity/);
    assert.match(source, /transform: \[\{ translateY: dragY \}\]/);
    assert.match(source, /photoViewerImageTransform/);
    assert.match(source, /resetPhotoViewerImageTransform/);
    assert.match(source, /closeViewer/);
    assert.match(source, /resetImage\(\)/);
    assert.match(source, /useEffect/);
    assert.match(source, /Dimensions,\n  FlatList,\n  Image,/);
    assert.match(source, /removeClippedSubviews=\{false\}/);
    assert.doesNotMatch(source, /FlatList,\n  Gesture,/);
    assert.doesNotMatch(source, /imageWrap/);
    assert.doesNotMatch(source, /PanResponder/);
    assert.doesNotMatch(source, /maximumZoomScale/);
    assert.doesNotMatch(source, /ScrollView/);
    assert.match(source, />Close</);
    assert.match(source, /onPress=\{closeViewer\}/);
    assert.match(source, /pagingEnabled/);
    assert.match(source, /directionalLockEnabled/);
  });
});
