import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PhotoUploadProgress } from "../components/admin-photo-uploads";
import {
  enqueuePhotoUploads,
  markPhotoUploadFailure,
  markPhotoUploadProgress,
  markPhotoUploadSuccess,
  photoUploadKey,
  photoUploadProgressLabel,
  retryPhotoUpload,
  sendOfferBlockedByRequiredPhotoUploads,
} from "./admin-photo-upload";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

describe("admin photo upload queue", () => {
  const fileA = { name: "front.jpg", size: 12, lastModified: 1 };
  const fileB = { name: "back.jpg", size: 34, lastModified: 2 };

  it("starts an independent queued entry for each newly selected file", () => {
    const first = enqueuePhotoUploads([], [fileA, fileB]);
    assert.deepEqual(first.started, [photoUploadKey(fileA), photoUploadKey(fileB)]);
    assert.equal(first.next.length, 2);
    assert.equal(first.next[0]?.progress, 0);
    assert.equal(first.next[0]?.status, "queued");
  });

  it("does not enqueue a duplicate of an in-flight file", () => {
    const first = enqueuePhotoUploads([], [fileA]);
    const again = enqueuePhotoUploads(first.next, [fileA, fileB]);
    assert.deepEqual(again.started, [photoUploadKey(fileB)]);
    assert.equal(again.next.length, 2);
  });

  it("selecting more photos later starts another upload", () => {
    const first = enqueuePhotoUploads([], [fileA]);
    const later = enqueuePhotoUploads(first.next, [fileB]);
    assert.deepEqual(later.started, [photoUploadKey(fileB)]);
  });

  it("tracks per-file progress and renders the percentage under the thumbnail", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    const progressing = markPhotoUploadProgress(queued, photoUploadKey(fileA), 72.4);
    assert.equal(progressing[0]?.progress, 72);
    assert.equal(progressing[0]?.status, "uploading");
    assert.equal(photoUploadProgressLabel(72.4), "72%");

    const html = renderToStaticMarkup(
      createElement(PhotoUploadProgress, {
        percent: 72,
        status: "uploading",
      }),
    );
    assert.match(html, /72%/);
    assert.match(html, /data-photo-upload-progress="uploading"/);
  });

  it("shows Retry on failure and retry does not duplicate a successful file", () => {
    const queued = enqueuePhotoUploads([], [fileA, fileB]).next;
    const failed = markPhotoUploadFailure(queued, photoUploadKey(fileA), "network");
    const html = renderToStaticMarkup(
      createElement(PhotoUploadProgress, {
        percent: 10,
        status: "error",
        error: "network",
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /Retry/);
    assert.match(html, /network/);

    const retried = retryPhotoUpload(failed, photoUploadKey(fileA));
    assert.equal(retried[0]?.status, "queued");
    const succeeded = markPhotoUploadSuccess(retried, photoUploadKey(fileB));
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0]?.key, photoUploadKey(fileA));
    const again = enqueuePhotoUploads(succeeded, [fileB]);
    assert.deepEqual(again.started, [photoUploadKey(fileB)]);
  });

  it("blocks Send Offer while a required exact-plant upload is in progress", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(queued, true), true);
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(queued, false), false);
    const done = markPhotoUploadSuccess(queued, photoUploadKey(fileA));
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(done, true), false);
  });
});

describe("admin photo upload UI wiring", () => {
  it("auto-starts upload on selection and keeps a no-JS Upload fallback", () => {
    const uploader = readFileSync(
      path.join(REPO_ROOT, "app", "components", "admin-photo-uploads.tsx"),
      "utf8",
    );
    const requestPage = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(uploader, /onChange=\{jsReady \? handleSelect : undefined\}/);
    assert.match(uploader, /multiple/);
    assert.match(uploader, /Upload plant photo/);
    assert.match(uploader, /startUpload/);
    assert.match(requestPage, /AdminPhotoUploader/);
    assert.match(requestPage, /photoUploadsInProgress/);
    assert.match(requestPage, /mergeAdminItemDraft/);
  });

  it("puts an immediate X on each uploaded thumbnail without a confirm dialog", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "app", "components", "photo-reorder.tsx"),
      "utf8",
    );
    assert.match(source, /data-photo-delete/);
    assert.match(source, /aria-label="Remove photo"/);
    assert.match(source, /top: 4/);
    assert.match(source, /right: 4/);
    assert.ok(!source.includes("confirm("));
    assert.ok(!source.includes("window.confirm"));
    assert.match(source, /intent/, "remove-photo");
    assert.match(source, /remove-photo/);
  });
});
