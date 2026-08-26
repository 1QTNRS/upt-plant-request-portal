import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
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
  });

  it("keeps the Close control and wires swipe-down dismiss", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoViewer.tsx"),
      "utf8",
    );
    assert.match(source, /shouldDismissPhotoViewer/);
    assert.match(source, /shouldCapturePhotoViewerDismiss/);
    assert.match(source, />Close</);
    assert.match(source, /onPress=\{onClose\}/);
    assert.match(source, /pagingEnabled/);
    assert.match(source, /maximumZoomScale=\{4\}/);
  });
});
