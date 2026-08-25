import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CUSTOMER_LIGHTBOX_SCRIPT } from "../components/customer-enhance";
import {
  CustomerLightboxRoot,
  CustomerPhotoGallery,
} from "../components/customer-photo-gallery";
import {
  lightboxIndex,
  swipeNavigates,
} from "./customer-lightbox";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

describe("customer photo lightbox", () => {
  it("wraps index left and right in display order", () => {
    assert.equal(lightboxIndex(0, -1, 3), 2);
    assert.equal(lightboxIndex(2, 1, 3), 0);
    assert.equal(lightboxIndex(1, 1, 3), 2);
    assert.equal(lightboxIndex(0, 1, 1), 0);
  });

  it("treats a horizontal swipe as previous or next", () => {
    assert.equal(swipeNavigates(-80, 4), 1);
    assert.equal(swipeNavigates(80, 4), -1);
    assert.equal(swipeNavigates(10, 4), 0);
    assert.equal(swipeNavigates(80, 120), 0);
  });

  it("renders clickable photos and a close control without admin chrome", () => {
    const html = renderToStaticMarkup(
      createElement(CustomerPhotoGallery, {
        urls: [
          "https://cdn.example.com/one.jpg",
          "https://cdn.example.com/two.jpg",
        ],
        alt: "Monstera Albo",
      }),
    );
    assert.match(html, /data-customer-photo/);
    assert.match(html, /data-gallery="Monstera Albo"/);
    assert.match(html, /data-index="0"/);
    assert.match(html, /data-index="1"/);
    assert.equal(html.includes("Move left"), false);
    assert.equal(html.includes("remove-photo"), false);
    assert.equal(html.includes("onclick"), false);
    assert.match(html, /flex-direction:row/);
    assert.doesNotMatch(html, /flex-direction:column/);
    assert.match(html, /width:64px!important/);
    assert.match(html, /height:64px!important/);
    assert.match(html, /width="64"/);
    assert.doesNotMatch(html, /max-width:calc/);
  });

  it("keeps the overlay hidden until opened, even with an inline flex style", () => {
    const html = renderToStaticMarkup(createElement(CustomerLightboxRoot));
    assert.match(html, /id="customer-lightbox"/);
    assert.match(html, /hidden/);
    assert.match(html, /#customer-lightbox\[hidden\]\{display:none!important\}/);
  });

  it("wires swipe, previous/next, and close in the enhance script", () => {
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-lightbox-prev/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-lightbox-next/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-lightbox-close/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /pointerdown/);
    assert.doesNotMatch(CUSTOMER_LIGHTBOX_SCRIPT, /setPointerCapture/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /lightbox-nav/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /pinToBody/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /__uptCustomerLightbox/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /document\.body\.appendChild/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /root\.focus\(\)/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /ArrowLeft/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /Escape/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-lightbox-image/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-customer-lightbox/);
    const offer = readFileSync(
      path.join(REPO_ROOT, "app", "components", "customer-offer-view.tsx"),
      "utf8",
    );
    const layout = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "customer.tsx"),
      "utf8",
    );
    assert.match(offer, /CustomerPhotoGallery/);
    assert.match(layout, /CustomerLightboxRoot/);
  });
});
