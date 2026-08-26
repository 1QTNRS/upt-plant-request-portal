import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  canPreviewPhoto,
  canReorderPhoto,
  mergeEditorPhotos,
  orderedPhotoIdsAfterUpload,
  PHOTO_UPLOAD_CONCURRENCY,
  photosFromPickerAssets,
  runPool,
  showsProgressBar,
  showsRetry,
} from "./photo-upload";

describe("multi-photo picker and progress", () => {
  it("creates one pending thumbnail per selected asset in order", () => {
    const pending = photosFromPickerAssets([
      { uri: "file:///a.jpg", fileName: "a.jpg" },
      { uri: "file:///b.jpg", fileName: "b.jpg" },
    ]);
    assert.equal(pending.length, 2);
    assert.deepEqual(
      pending.map((photo) => photo.url),
      ["file:///a.jpg", "file:///b.jpg"],
    );
    assert.ok(pending.every((photo) => photo.status === "uploading"));
    assert.ok(pending.every((photo) => photo.progress === 0));
    assert.notEqual(pending[0].clientKey, pending[1].clientKey);
  });

  it("shows pending thumbnails immediately after existing photos", () => {
    const merged = mergeEditorPhotos(
      [{ id: "p1", url: "https://cdn.example/1.jpg" }],
      photosFromPickerAssets([{ uri: "file:///new.jpg" }]),
    );
    assert.deepEqual(
      merged.map((photo) => photo.id === "p1" ? "ready" : photo.status),
      ["ready", "uploading"],
    );
    assert.equal(merged[1].url, "file:///new.jpg");
  });

  it("shows a progress bar without percentage text while uploading", () => {
    assert.equal(showsProgressBar({ status: "uploading" }), true);
    assert.equal(showsProgressBar({ status: "ready" }), false);
    assert.equal(showsProgressBar({ status: "failed" }), false);
    const strip = readFileSync(
      path.join(import.meta.dirname, "components", "PhotoStrip.tsx"),
      "utf8",
    );
    assert.match(strip, /showsProgressBar/);
    assert.match(strip, /progressFill/);
    assert.doesNotMatch(strip, /%/);
    assert.doesNotMatch(strip, /toFixed\(0\)/);
  });

  it("makes a completed photo zoomable and hides its progress bar", () => {
    assert.equal(canPreviewPhoto({ status: "ready" }), true);
    assert.equal(showsProgressBar({ status: "ready" }), false);
    assert.equal(canReorderPhoto({ id: "p1", status: "ready" }), true);
  });

  it("does not open the viewer for an uploading photo", () => {
    assert.equal(canPreviewPhoto({ status: "uploading" }), false);
    assert.equal(canReorderPhoto({ id: "local", status: "uploading" }), false);
  });

  it("shows retry on failure and keeps the same client key", () => {
    const [photo] = photosFromPickerAssets([{ uri: "file:///fail.jpg" }]);
    const failed = { ...photo, status: "failed" as const };
    assert.equal(showsRetry(failed), true);
    assert.equal(failed.clientKey, photo.clientKey);
  });

  it("uploads concurrently with a bounded pool", async () => {
    assert.equal(PHOTO_UPLOAD_CONCURRENCY, 3);
    const seen: number[] = [];
    let active = 0;
    let max = 0;
    await runPool([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      max = Math.max(max, active);
      seen.push(value);
      await Promise.resolve();
      active -= 1;
    });
    assert.deepEqual(seen.sort(), [1, 2, 3, 4]);
    assert.ok(max <= 2);
  });

  it("asks the library picker for multiple images", () => {
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(editor, /allowsMultipleSelection:\s*true/);
    assert.match(editor, /orderedSelection:\s*true/);
    assert.match(editor, /Upload Photos/);
    assert.match(editor, /apiUploadPhoto/);
    assert.match(editor, /uploadKey: photo\.clientKey/);
  });

  it("retries with the same client key so a successful upload is not duplicated", () => {
    const [photo] = photosFromPickerAssets([{ uri: "file:///same.jpg" }]);
    const retryKey = photo.clientKey;
    assert.ok(retryKey);
    const retried = { ...photo, status: "uploading" as const, progress: 0 };
    assert.equal(retried.clientKey, retryKey);
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(editor, /uploadKey: photo\.clientKey/);
    assert.match(editor, /retryPhoto/);
    const kept = ["p1"];
    const uploaded = new Map([[retryKey, "p-new"]]);
    assert.deepEqual(orderedPhotoIdsAfterUpload(kept, [retryKey], uploaded), [
      "p1",
      "p-new",
    ]);
  });
});
