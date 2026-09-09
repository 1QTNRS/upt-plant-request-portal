import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminPhotoLightbox } from "../components/admin-photo-lightbox";
import { CUSTOMER_LIGHTBOX_SCRIPT } from "../components/customer-enhance";
import { CustomerLightboxRoot } from "../components/customer-photo-gallery";
import {
  dismissSwipe,
  gallerySwipe,
  isBaseScale,
  lockPageScroll,
  pinchScale,
  pinchScaleFromTouches,
  touchPairDistance,
} from "./mobile-lightbox";

describe("mobile lightbox helpers", () => {
  it("locks and restores page scroll position", () => {
    const scrollToCalls: number[][] = [];
    const doc = {
      body: {
        style: { overflow: "", position: "", top: "", width: "" },
      },
      documentElement: { style: { overflow: "" } },
      defaultView: {
        scrollY: 120,
        scrollTo: (x: number, y: number) => scrollToCalls.push([x, y]),
      },
    } as unknown as Document;
    const lock = lockPageScroll(doc);
    assert.ok(lock);
    assert.equal(doc.body.style.position, "fixed");
    assert.equal(doc.body.style.top, "-120px");
    lock?.unlock();
    assert.deepEqual(scrollToCalls, [[0, 120]]);
  });

  it("supports pinch zoom within bounds", () => {
    assert.equal(pinchScale(200, 100, 1), 2);
    assert.equal(pinchScale(50, 100, 2), 1);
    assert.equal(pinchScale(500, 100, 1), 4);
  });

  it("derives pinch scale from two touch contacts for iOS Safari", () => {
    assert.equal(touchPairDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }), 5);
    assert.equal(
      pinchScaleFromTouches(
        { clientX: 0, clientY: 0 },
        { clientX: 200, clientY: 0 },
        100,
        1,
      ),
      2,
    );
  });

  it("navigates gallery horizontally only at base scale with multiple images", () => {
    assert.equal(gallerySwipe(-80, 4, 2, 1), 1);
    assert.equal(gallerySwipe(80, 4, 2, 1), -1);
    assert.equal(gallerySwipe(-80, 4, 1, 1), 0);
    assert.equal(gallerySwipe(-80, 4, 2, 2), 0);
  });

  it("dismisses on sufficient downward drag at base scale", () => {
    assert.equal(isBaseScale(1), true);
    assert.equal(isBaseScale(1.5), false);
    assert.equal(dismissSwipe(100), true);
    assert.equal(dismissSwipe(20), false);
  });

  it("renders admin lightbox with mobile gesture hooks", () => {
    const html = renderToStaticMarkup(
      createElement(AdminPhotoLightbox, {
        urls: ["https://cdn.example.com/one.jpg"],
        alt: "Plant",
        startIndex: 0,
        onClose: () => undefined,
      }),
    );
    assert.match(html, /data-lightbox-transform/);
    assert.match(html, /data-lightbox-stage/);
    assert.match(html, /touch-action: none/);
    assert.match(html, /draggable="false"/);
  });

  it("wires customer lightbox scroll lock, pinch, and dismiss in enhance script", () => {
    const html = renderToStaticMarkup(createElement(CustomerLightboxRoot));
    assert.match(html, /data-lightbox-transform/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /lockScroll/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /unlockScroll/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /pointermove/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /touchstart/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /touchmove/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /passive: false/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /pinchStart/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /DISMISS_PX/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /urls.length <= 1/);
  });
});
