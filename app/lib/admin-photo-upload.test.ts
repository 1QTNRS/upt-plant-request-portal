import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PhotoUploadProgress } from "../components/admin-photo-uploads";
import {
  adminPhotoUploadHeaders,
  applyAdminPhotoUploadHeaders,
  cancelPhotoUpload,
  describeUnreadableUploadResponse,
  dropReconciledUploads,
  enqueuePhotoUploads,
  markPhotoUploadFailure,
  markPhotoUploadProgress,
  markPhotoUploadSuccess,
  mergePhotoCards,
  parseUploadActionResponse,
  photoUploadThrownErrorPayload,
  photoUploadKey,
  photoUploadProgressLabel,
  readEmbeddedAdminSessionToken,
  retryPhotoUpload,
  sendOfferBlockedByRequiredPhotoUploads,
  transportProgressPercent,
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

  it("does not treat 100% transport progress as Uploaded", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    const wireDone = markPhotoUploadProgress(
      queued,
      photoUploadKey(fileA),
      transportProgressPercent(100, 100),
    );
    assert.equal(wireDone[0]?.status, "uploading");
    assert.equal(wireDone[0]?.progress, 99);
    assert.equal(transportProgressPercent(100, 100), 99);

    const html = renderToStaticMarkup(
      createElement(PhotoUploadProgress, {
        percent: 99,
        status: "uploading",
      }),
    );
    assert.match(html, /99%/);
    assert.doesNotMatch(html, /Uploaded/);
  });

  it("moves from transport-complete to Uploaded only after a finalized photo", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    const waiting = markPhotoUploadProgress(queued, photoUploadKey(fileA), 100);
    assert.equal(waiting[0]?.status, "uploading");
    const done = markPhotoUploadSuccess(waiting, photoUploadKey(fileA), {
      id: "photo-1",
      url: "https://cdn.example.com/front.jpg",
    });
    assert.equal(done[0]?.status, "success");
    assert.equal(done[0]?.photoId, "photo-1");
    const html = renderToStaticMarkup(
      createElement(PhotoUploadProgress, {
        percent: 100,
        status: "success",
      }),
    );
    assert.match(html, /Uploaded/);
  });

  it("a delayed finalize still leaves the card uploading, not permanently at 100% success", () => {
    const queued = enqueuePhotoUploads([], [fileA, fileB]).next;
    const delayed = markPhotoUploadProgress(queued, photoUploadKey(fileA), 100);
    const other = markPhotoUploadProgress(delayed, photoUploadKey(fileB), 40);
    assert.equal(other[0]?.status, "uploading");
    assert.equal(other[1]?.status, "uploading");
    const firstDone = markPhotoUploadSuccess(other, photoUploadKey(fileA), {
      id: "a",
      url: "/a.jpg",
    });
    assert.equal(firstDone[0]?.status, "success");
    assert.equal(firstDone[1]?.status, "uploading");
  });

  it("failed finalize shows Failed / Retry and retry does not touch successes", () => {
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

    const succeeded = markPhotoUploadSuccess(failed, photoUploadKey(fileB), {
      id: "b",
      url: "/b.jpg",
    });
    const retried = retryPhotoUpload(succeeded, photoUploadKey(fileA));
    assert.equal(retried[0]?.status, "queued");
    assert.equal(retried[1]?.status, "success");
    const again = enqueuePhotoUploads(retried, [fileB]);
    assert.deepEqual(again.started, []);
  });

  it("parses a JSON finalize body and rejects an empty or failed body", () => {
    assert.deepEqual(
      parseUploadActionResponse(
        JSON.stringify({ ok: true, photo: { id: "p1", url: "https://cdn/x.jpg" } }),
      ),
      { ok: true, photo: { id: "p1", url: "https://cdn/x.jpg" }, uploadKey: undefined },
    );
    assert.equal(parseUploadActionResponse("").ok, false);
    assert.equal(
      parseUploadActionResponse(JSON.stringify({ ok: false, error: "Shopify timed out" }))
        .ok,
      false,
    );
    const turbo = parseUploadActionResponse(
      '[{"_1":2},"data",{"ok":true,"photo":{"id":"p2","url":"https://cdn/y.jpg"}}]',
    );
    assert.equal(turbo.ok, true);
    if (turbo.ok) assert.equal(turbo.photo.id, "p2");
  });

  it("explains HTML bounce and Bad Request bodies instead of a generic parse error", () => {
    const html = parseUploadActionResponse(
      "<!DOCTYPE html><html><body>App Bridge bounce</body></html>",
    );
    assert.equal(html.ok, false);
    if (!html.ok) {
      assert.match(html.error, /Reload the page/);
      assert.notEqual(html.error, "Could not read the upload response.");
    }
    assert.equal(
      describeUnreadableUploadResponse("Bad Request"),
      "Upload was rejected. Reload the page and try again.",
    );
  });

  it("reads the embedded admin session token for the XHR Authorization header", async () => {
    assert.equal(await readEmbeddedAdminSessionToken(undefined), undefined);
    assert.equal(await readEmbeddedAdminSessionToken({}), undefined);
    assert.equal(
      await readEmbeddedAdminSessionToken({
        idToken: async () => {
          throw new Error("not ready");
        },
      }),
      undefined,
    );
    assert.equal(
      await readEmbeddedAdminSessionToken({
        ready: Promise.resolve(),
        idToken: async () => "  session.jwt  ",
      }),
      "session.jwt",
    );

    const headers = adminPhotoUploadHeaders("session.jwt");
    assert.equal(headers.Accept, "application/json");
    assert.equal(headers.Authorization, "Bearer session.jwt");
    assert.equal(adminPhotoUploadHeaders().Authorization, undefined);

    const recorded: Record<string, string> = {};
    applyAdminPhotoUploadHeaders(
      { setRequestHeader: (name, value) => { recorded[name] = value; } },
      "session.jwt",
    );
    assert.equal(recorded.Authorization, "Bearer session.jwt");
    assert.equal(recorded.Accept, "application/json");
  });

  it("turns an HTML bounce Response into a JSON-readable failure", () => {
    const bounce = photoUploadThrownErrorPayload(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    assert.ok(bounce);
    assert.equal(bounce?.status, 401);
    assert.match(bounce?.error ?? "", /Reload the page/);

    const json = new Response(JSON.stringify({ ok: false, error: "nope" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    assert.equal(photoUploadThrownErrorPayload(json), null);
  });

  it("merges one card per photo and drops a local success after refresh reconcile", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    const done = markPhotoUploadSuccess(queued, photoUploadKey(fileA), {
      id: "photo-1",
      url: "https://cdn.example.com/front.jpg",
    });
    const server = [
      { id: "existing", url: "https://cdn.example.com/old.jpg" },
      { id: "photo-1", url: "https://cdn.example.com/front.jpg" },
    ];
    const cards = mergePhotoCards(server, done);
    assert.equal(cards.length, 2);
    assert.equal(cards.filter((card) => card.kind === "saved").length, 2);
    assert.equal(
      cards.filter(
        (card) => card.kind === "saved" && card.photo.id === "photo-1",
      ).length,
      1,
    );

    const afterRefresh = dropReconciledUploads(done, server);
    assert.equal(afterRefresh.length, 0);
    assert.equal(mergePhotoCards(server, afterRefresh).length, 2);
  });

  it("cancels a queued file without removing saved photos", () => {
    const queued = enqueuePhotoUploads([], [fileA, fileB]).next;
    const cancelled = cancelPhotoUpload(queued, photoUploadKey(fileA));
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0]?.key, photoUploadKey(fileB));
  });

  it("blocks Send Offer while a required exact-plant upload is in progress", () => {
    const queued = enqueuePhotoUploads([], [fileA]).next;
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(queued, true), true);
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(queued, false), false);
    const done = markPhotoUploadSuccess(queued, photoUploadKey(fileA), {
      id: "p",
      url: "/p.jpg",
    });
    assert.equal(sendOfferBlockedByRequiredPhotoUploads(done, true), false);
  });
});

describe("admin photo upload UI wiring", () => {
  it("auto-starts upload on selection against the JSON photos route", () => {
    const uploader = readFileSync(
      path.join(REPO_ROOT, "app", "components", "admin-photo-uploads.tsx"),
      "utf8",
    );
    const requestPage = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const photosRoute = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.photos.ts"),
      "utf8",
    );
    assert.match(uploader, /onChange=\{jsReady \? handleSelect : undefined\}/);
    assert.match(uploader, /multiple/);
    assert.match(uploader, /Upload plant photo/);
    assert.match(uploader, /data-admin-photo-file-picker/);
    assert.match(uploader, /Choose files/);
    assert.match(uploader, /No file selected/);
    assert.match(uploader, /variant="secondary"/);
    assert.match(uploader, /startUpload/);
    assert.match(uploader, /\/photos/);
    assert.match(uploader, /parseUploadActionResponse/);
    assert.match(uploader, /xhr\.responseText/);
    assert.match(uploader, /readEmbeddedAdminSessionToken/);
    assert.match(uploader, /applyAdminPhotoUploadHeaders/);
    assert.match(requestPage, /AdminPhotoStrip/);
    assert.match(requestPage, /AdminPhotoThumbs/);
    assert.match(uploader, /AdminPhotoLightbox/);
    assert.match(uploader, /data-admin-photo-thumb/);
    assert.match(requestPage, /photoUploadsInProgress/);
    assert.match(requestPage, /mergeAdminItemDraft/);
    assert.match(photosRoute, /photoUploadThrownErrorPayload/);
    assert.match(photosRoute, /Response\.json/);
  });

  it("puts an immediate X on each thumbnail without a confirm dialog", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "app", "components", "admin-photo-uploads.tsx"),
      "utf8",
    );
    assert.match(source, /data-photo-delete/);
    assert.match(source, /aria-label="Remove photo"/);
    assert.ok(!source.includes("confirm("));
    assert.ok(!source.includes("window.confirm"));
    assert.match(source, /cancelPending/);
    assert.match(source, /removeSaved/);
  });
});
