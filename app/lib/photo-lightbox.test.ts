import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminPhotoLightbox } from "../components/admin-photo-lightbox";
import { lightboxIndex, swipeNavigates } from "./photo-lightbox";

describe("photo lightbox helpers", () => {
  it("wraps index left and right in display order", () => {
    assert.equal(lightboxIndex(0, -1, 3), 2);
    assert.equal(lightboxIndex(2, 1, 3), 0);
    assert.equal(lightboxIndex(1, 1, 3), 2);
  });

  it("treats a horizontal swipe as previous or next", () => {
    assert.equal(swipeNavigates(-80, 4), 1);
    assert.equal(swipeNavigates(80, 4), -1);
    assert.equal(swipeNavigates(10, 4), 0);
    assert.equal(swipeNavigates(80, 120), 0);
  });

  it("renders admin viewer chrome without customer PII or queue actions", () => {
    const html = renderToStaticMarkup(
      createElement(AdminPhotoLightbox, {
        urls: ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
        alt: "Thai Constellation",
        startIndex: 0,
        onClose: () => undefined,
      }),
    );
    assert.match(html, /data-admin-photo-lightbox/);
    assert.match(html, /× Close/);
    assert.match(html, /Previous/);
    assert.match(html, /Next/);
    assert.match(html, /1 of 2/);
    assert.equal(html.includes("Dismiss"), false);
    assert.equal(html.includes("customerEmail"), false);
  });
});
