import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  mergeEditorPhotos,
  mountPhotoStrip,
  shouldReplaceStripOrder,
  type EditorPhoto,
} from "./photo-upload";

function ready(id: string, url = `https://cdn.example/${id}.jpg`): EditorPhoto {
  return { id, url, status: "ready", progress: 1 };
}

function uploading(id: string, progress: number): EditorPhoto {
  return { id, url: `file:///${id}.jpg`, status: "uploading", progress };
}

describe("PhotoStrip prop sync", () => {
  it("does not replace local order when parent passes a new equal photos array", () => {
    const photos = [ready("p1"), uploading("local", 0.4)];
    assert.equal(shouldReplaceStripOrder(photos, [...photos]), false);
    assert.equal(
      shouldReplaceStripOrder(
        photos,
        mergeEditorPhotos([{ id: "p1", url: photos[0].url }], [photos[1]]),
      ),
      false,
    );
  });

  it("replaces local order when progress, status, or ids change", () => {
    const first = [ready("p1"), uploading("local", 0.2)];
    assert.equal(shouldReplaceStripOrder(first, [ready("p1"), uploading("local", 0.8)]), true);
    assert.equal(
      shouldReplaceStripOrder(first, [ready("p1"), { ...first[1], status: "failed" }]),
      true,
    );
    assert.equal(shouldReplaceStripOrder(first, [ready("p1"), ready("p2")]), true);
  });

  it("mounts PhotoStrip-style props without repeated state updates", () => {
    const seed = [ready("p1"), uploading("local", 0.3)];
    const parentRenders = Array.from({ length: 40 }, () => ({
      photos: mergeEditorPhotos([{ id: "p1", url: seed[0].url }], [seed[1]]),
    }));
    parentRenders[0] = { photos: seed };
    const mounted = mountPhotoStrip(parentRenders);
    assert.equal(mounted.setStateCalls, 0);
    assert.ok(mounted.renderCount <= 40);
    assert.deepEqual(
      mounted.order.map((photo) => photo.id),
      ["p1", "local"],
    );
  });

  it("still syncs a real progress or retry change after mount", () => {
    const seed = [ready("p1"), uploading("local", 0.3)];
    const mounted = mountPhotoStrip([
      { photos: seed },
      { photos: mergeEditorPhotos([{ id: "p1", url: seed[0].url }], [seed[1]]) },
      { photos: [ready("p1"), uploading("local", 0.9)] },
      { photos: [ready("p1"), { ...seed[1], status: "failed", progress: 0 }] },
    ]);
    assert.equal(mounted.setStateCalls, 2);
    assert.equal(mounted.order[1].status, "failed");
  });

  it("guards the PhotoStrip effect so equal photos do not setState", () => {
    const strip = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoStrip.tsx"),
      "utf8",
    );
    assert.match(strip, /shouldReplaceStripOrder\(orderRef\.current, photos\)/);
    assert.match(strip, /if \(draggedId\.current\) return/);
    assert.match(strip, /showsProgressBar/);
    assert.match(strip, /showsRetry/);
    assert.match(strip, /canPreviewPhoto/);
    assert.match(strip, /canReorderPhoto/);
  });
});
