import { useEffect, useRef, useState } from "react";
import { useFetcher, useParams, useRevalidator } from "react-router";

import { adminDialogButtonStyle } from "./admin-confirm-dialog";
import { AdminPhotoLightbox } from "./admin-photo-lightbox";
import {
  applyAdminPhotoUploadHeaders,
  cancelPhotoUpload,
  dropReconciledUploads,
  enqueuePhotoUploads,
  markPhotoUploadFailure,
  markPhotoUploadProgress,
  markPhotoUploadSuccess,
  mergePhotoCards,
  parseUploadActionResponse,
  PHOTO_UPLOAD_WATCHDOG_MS,
  photoUploadProgressLabel,
  readEmbeddedAdminSessionToken,
  retryPhotoUpload,
  sendOfferBlockedByRequiredPhotoUploads,
  transportProgressPercent,
  type EmbeddedAdminBridge,
  type PhotoUploadEntry,
  type SavedPhotoRef,
} from "../lib/admin-photo-upload";

const deleteButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 14,
  background: "rgba(32, 34, 35, 0.85)",
  color: "#fff",
  font: "inherit",
  fontWeight: 700,
  lineHeight: "28px",
  cursor: "pointer",
  padding: 0,
};

export function PhotoUploadProgress({
  percent,
  status,
  error,
  onRetry,
}: {
  percent: number;
  status: PhotoUploadEntry["status"];
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div data-photo-upload-progress={status} style={{ fontSize: 12, textAlign: "center" }}>
      {status === "error" ? (
        <>
          <div style={{ color: "#d72c0d" }}>{error || "Upload failed"}</div>
          {onRetry ? (
            <button type="button" onClick={onRetry} style={{ marginTop: 4, font: "inherit" }}>
              Retry
            </button>
          ) : null}
        </>
      ) : status === "success" ? (
        <div style={{ color: "#008060" }}>Uploaded</div>
      ) : (
        <div>{photoUploadProgressLabel(percent)}</div>
      )}
    </div>
  );
}

export function AdminPhotoStrip({
  itemId,
  photos,
  alt,
  required,
  onRequiredBusyChange,
}: {
  itemId: string;
  photos: SavedPhotoRef[];
  alt: string;
  required: boolean;
  onRequiredBusyChange?: (busy: boolean) => void;
}) {
  const params = useParams();
  const requestId = String(params.id || "");
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const [uploads, setUploads] = useState<PhotoUploadEntry[]>([]);
  const [jsReady, setJsReady] = useState(false);
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState(photos.map((photo) => photo.id));
  const filesByKey = useRef(new Map<string, File>());
  const previewByKey = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const watchdogs = useRef(new Map<string, number>());
  const dragId = useRef<string | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const onBusyRef = useRef(onRequiredBusyChange);
  onBusyRef.current = onRequiredBusyChange;

  useEffect(() => {
    setJsReady(true);
  }, []);

  useEffect(() => {
    setOrder(photos.map((photo) => photo.id));
    setUploads((current) => dropReconciledUploads(current, photos));
  }, [photos]);

  useEffect(() => {
    onBusyRef.current?.(
      sendOfferBlockedByRequiredPhotoUploads(uploads, required),
    );
  }, [uploads, required]);

  useEffect(() => {
    const xhrMap = xhrs.current;
    const watchdogMap = watchdogs.current;
    const previewMap = previewByKey.current;
    return () => {
      onBusyRef.current?.(false);
      for (const xhr of xhrMap.values()) xhr.abort();
      for (const timer of watchdogMap.values()) window.clearTimeout(timer);
      for (const url of previewMap.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const persistOrder = (next: string[]) => {
    const data = new FormData();
    data.set("intent", "reorder-photos");
    data.set("itemId", itemId);
    data.set("photoIds", next.join(","));
    fetcher.submit(data, { method: "post" });
  };

  const moveIndex = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    persistOrder(next);
  };

  const clearWatchdog = (key: string) => {
    const timer = watchdogs.current.get(key);
    if (timer) window.clearTimeout(timer);
    watchdogs.current.delete(key);
  };

  const startUpload = (key: string) => {
    void runUpload(key);
  };

  const runUpload = async (key: string) => {
    const file = filesByKey.current.get(key);
    if (!file || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setUploads((current) => markPhotoUploadProgress(current, key, 0));

    const finalize = () => {
      inFlight.current.delete(key);
      xhrs.current.delete(key);
      clearWatchdog(key);
    };
    watchdogs.current.set(
      key,
      window.setTimeout(() => {
        if (!inFlight.current.has(key)) return;
        xhrs.current.get(key)?.abort();
        setUploads((current) =>
          markPhotoUploadFailure(current, key, "Upload timed out"),
        );
      }, PHOTO_UPLOAD_WATCHDOG_MS),
    );

    // App Bridge patches `fetch` (so useFetcher works) but not XHR. Without
    // Authorization, Shopify treats this as a document request and returns HTML.
    const shopify =
      typeof window === "undefined"
        ? undefined
        : (window as Window & { shopify?: EmbeddedAdminBridge }).shopify;
    const token = await readEmbeddedAdminSessionToken(shopify);
    if (!inFlight.current.has(key)) return;

    const body = new FormData();
    body.set("intent", "upload-photo");
    body.set("itemId", itemId);
    body.set("uploadKey", key);
    body.set("photo", file);

    const xhr = new XMLHttpRequest();
    xhrs.current.set(key, xhr);
    // Dedicated JSON resource — not the page `.data` stream, which can leave
    // transport-complete XHRs waiting on unrelated loaders.
    xhr.open("POST", `/app/requests/${requestId}/photos`);
    xhr.withCredentials = true;
    xhr.timeout = PHOTO_UPLOAD_WATCHDOG_MS;
    xhr.responseType = "text";
    applyAdminPhotoUploadHeaders(xhr, token);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setUploads((current) =>
        markPhotoUploadProgress(
          current,
          key,
          transportProgressPercent(event.loaded, event.total),
        ),
      );
    };
    xhr.onload = () => {
      const bodyText = xhr.responseText || "";
      const parsed = parseUploadActionResponse(bodyText);
      finalize();
      if (xhr.status >= 200 && xhr.status < 400 && parsed.ok) {
        setUploads((current) => markPhotoUploadSuccess(current, key, parsed.photo));
        revalidator.revalidate();
        return;
      }
      setUploads((current) =>
        markPhotoUploadFailure(
          current,
          key,
          parsed.ok ? xhr.statusText || "Upload failed" : parsed.error,
        ),
      );
    };
    xhr.onerror = () => {
      finalize();
      setUploads((current) => markPhotoUploadFailure(current, key, "Upload failed"));
    };
    xhr.ontimeout = () => {
      finalize();
      setUploads((current) =>
        markPhotoUploadFailure(current, key, "Upload timed out"),
      );
    };
    xhr.onabort = () => {
      finalize();
    };
    xhr.send(body);
  };

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    setSelectedFileNames(selected.map((file) => file.name));
    if (selected.length === 0) return;
    const { next, started } = enqueuePhotoUploads(
      uploads,
      selected.map((file) => ({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      })),
    );
    for (const file of selected) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!started.includes(key)) continue;
      filesByKey.current.set(key, file);
      previewByKey.current.set(key, URL.createObjectURL(file));
    }
    setUploads(next);
    for (const key of started) startUpload(key);
    event.currentTarget.value = "";
  };

  const removeSaved = (photoId: string) => {
    const data = new FormData();
    data.set("intent", "remove-photo");
    data.set("itemId", itemId);
    data.set("photoId", photoId);
    fetcher.submit(data, { method: "post" });
    setOrder((current) => current.filter((id) => id !== photoId));
    setUploads((current) =>
      current.filter((entry) => entry.photoId !== photoId),
    );
  };

  const cancelPending = (key: string) => {
    const xhr = xhrs.current.get(key);
    if (xhr) xhr.abort();
    setUploads((current) => cancelPhotoUpload(current, key));
    filesByKey.current.delete(key);
    const preview = previewByKey.current.get(key);
    if (preview) {
      URL.revokeObjectURL(preview);
      previewByKey.current.delete(key);
    }
  };

  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const orderedSaved = order
    .map((id) => byId.get(id))
    .filter((photo): photo is SavedPhotoRef => Boolean(photo));
  const cards = mergePhotoCards(orderedSaved, uploads);
  const viewerUrls = orderedSaved.map((photo) => photo.url);

  return (
    <div
      data-admin-photo-strip
      style={{ display: "flex", flexDirection: "column", gap: 24 }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          touchAction: "none",
        }}
      >
        {cards.map((card) => {
          if (card.kind === "pending") {
            const preview = previewByKey.current.get(card.upload.key) || "";
            return (
              <div
                key={card.upload.key}
                data-pending-photo={card.upload.key}
                data-photo-card="pending"
                style={{ width: 120 }}
              >
                <div style={{ position: "relative", width: 120 }}>
                  {preview ? (
                    <img
                      src={preview}
                      alt={card.upload.name}
                      width={120}
                      height={120}
                      style={{
                        display: "block",
                        objectFit: "cover",
                        borderRadius: 8,
                        maxWidth: "100%",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 120,
                        height: 120,
                        borderRadius: 8,
                        background: "#f1f2f3",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    data-photo-delete
                    aria-label="Remove photo"
                    onClick={() => cancelPending(card.upload.key)}
                    style={deleteButtonStyle}
                  >
                    ×
                  </button>
                </div>
                <PhotoUploadProgress
                  percent={card.upload.progress}
                  status={card.upload.status}
                  error={card.upload.error}
                  onRetry={
                    card.upload.status === "error"
                      ? () => {
                          setUploads((current) =>
                            retryPhotoUpload(current, card.upload.key),
                          );
                          startUpload(card.upload.key);
                        }
                      : undefined
                  }
                />
              </div>
            );
          }

          const photo = card.photo;
          const savedIndex = orderedSaved.findIndex((entry) => entry.id === photo.id);
          return (
            <div
              key={photo.id}
              data-photo-id={photo.id}
              data-photo-card="saved"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if ((event.target as HTMLElement | null)?.closest("[data-photo-delete]")) {
                  return;
                }
                dragId.current = photo.id;
                dragOrigin.current = { x: event.clientX, y: event.clientY };
                (event.currentTarget as HTMLElement).setPointerCapture(
                  event.pointerId,
                );
              }}
              onPointerUp={(event) => {
                if (!dragId.current) return;
                const origin = dragOrigin.current;
                const moved =
                  origin &&
                  (Math.abs(event.clientX - origin.x) > 8 ||
                    Math.abs(event.clientY - origin.y) > 8);
                const hit = document
                  .elementsFromPoint(event.clientX, event.clientY)
                  .find(
                    (node) =>
                      node instanceof HTMLElement && node.dataset.photoId,
                  );
                const targetId =
                  hit instanceof HTMLElement ? hit.dataset.photoId : undefined;
                const from = order.indexOf(dragId.current);
                const to = targetId ? order.indexOf(targetId) : -1;
                dragId.current = null;
                dragOrigin.current = null;
                if (moved && from >= 0 && to >= 0 && from !== to) {
                  moveIndex(from, to);
                  return;
                }
                if (!moved && savedIndex >= 0) {
                  setViewerIndex(savedIndex);
                }
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                cursor: "zoom-in",
                userSelect: "none",
                width: 120,
              }}
            >
              <div style={{ position: "relative", width: 120 }}>
                <img
                  src={photo.url}
                  alt={alt}
                  width={120}
                  height={120}
                  draggable={false}
                  data-admin-photo-thumb
                  style={{
                    display: "block",
                    objectFit: "cover",
                    borderRadius: 8,
                    maxWidth: "100%",
                    pointerEvents: "none",
                  }}
                />
                <button
                  type="button"
                  data-photo-delete
                  aria-label="Remove photo"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeSaved(photo.id);
                  }}
                  style={deleteButtonStyle}
                >
                  ×
                </button>
              </div>
              {card.uploadKey ? (
                <div data-photo-upload-progress="success" style={{ fontSize: 12, textAlign: "center", color: "#008060" }}>
                  Uploaded
                </div>
              ) : null}
              {savedIndex === 0 ? (
                <s-badge tone="info">Customer sees first</s-badge>
              ) : null}
              <s-stack direction="inline" gap="small">
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="move-photo" />
                  <input type="hidden" name="itemId" value={itemId} />
                  <input type="hidden" name="photoId" value={photo.id} />
                  <input type="hidden" name="direction" value="up" />
                  <s-button
                    variant="secondary"
                    type="submit"
                    {...(savedIndex === 0 ? { disabled: true } : {})}
                  >
                    Move left
                  </s-button>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="move-photo" />
                  <input type="hidden" name="itemId" value={itemId} />
                  <input type="hidden" name="photoId" value={photo.id} />
                  <input type="hidden" name="direction" value="down" />
                  <s-button
                    variant="secondary"
                    type="submit"
                    {...(savedIndex === orderedSaved.length - 1
                      ? { disabled: true }
                      : {})}
                  >
                    Move right
                  </s-button>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="remove-photo" />
                  <input type="hidden" name="itemId" value={itemId} />
                  <input type="hidden" name="photoId" value={photo.id} />
                  <s-button variant="secondary" tone="critical" type="submit">
                    Remove
                  </s-button>
                </fetcher.Form>
              </s-stack>
            </div>
          );
        })}
      </div>
      <form
        method="post"
        encType="multipart/form-data"
        action={`/app/requests/${requestId}`}
        style={{ marginTop: 8 }}
      >
        <input type="hidden" name="intent" value="upload-photo" />
        <input type="hidden" name="itemId" value={itemId} />
        <input
          ref={fileInputRef}
          id={`plant-photo-${itemId}`}
          className={jsReady ? "admin-photo-file-input-hidden" : "admin-photo-file-input"}
          type="file"
          name="photo"
          accept="image/*"
          multiple
          data-admin-photo-file
          onChange={jsReady ? handleSelect : undefined}
          style={
            jsReady
              ? {
                  position: "absolute",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  overflow: "hidden",
                }
              : undefined
          }
        />
        {jsReady ? (
          <div
            data-admin-photo-file-picker
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              maxWidth: "100%",
            }}
          >
            <button
              type="button"
              data-admin-photo-choose-files
              onClick={() => fileInputRef.current?.click()}
              style={adminDialogButtonStyle}
            >
              Choose files
            </button>
            <span
              data-admin-photo-file-label
              style={{
                font: "inherit",
                lineHeight: "44px",
                minHeight: 44,
              }}
            >
              {selectedFileNames.length > 0
                ? selectedFileNames.join(", ")
                : "No file selected"}
            </span>
          </div>
        ) : (
          <s-button variant="secondary" type="submit">
            Upload plant photo
          </s-button>
        )}
      </form>
      {viewerIndex !== null && viewerUrls.length > 0 ? (
        <AdminPhotoLightbox
          urls={viewerUrls}
          alt={alt}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </div>
  );
}

export function AdminPhotoThumbs({
  photos,
  alt,
}: {
  photos: Array<{ url: string }>;
  alt: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const urls = photos.map((photo) => photo.url).filter(Boolean);
  if (urls.length === 0) return null;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {urls.map((url, index) => (
          <button
            key={url}
            type="button"
            data-admin-photo-thumb
            aria-label={
              urls.length > 1
                ? `View ${alt}, photo ${index + 1} of ${urls.length}`
                : `View ${alt}`
            }
            onClick={() => setViewerIndex(index)}
            style={{
              padding: 0,
              border: "none",
              background: "none",
              cursor: "zoom-in",
            }}
          >
            <img
              src={url}
              alt={alt}
              width={120}
              height={120}
              style={{
                display: "block",
                objectFit: "cover",
                borderRadius: 8,
                maxWidth: "100%",
              }}
            />
            {index === 0 ? (
              <s-badge tone="info">Customer sees first</s-badge>
            ) : null}
          </button>
        ))}
      </div>
      {viewerIndex !== null ? (
        <AdminPhotoLightbox
          urls={urls}
          alt={alt}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </>
  );
}

/** @deprecated Use AdminPhotoStrip — kept so existing tests can import progress. */
export function AdminPhotoUploader({
  itemId,
  required,
  onRequiredBusyChange,
}: {
  itemId: string;
  required: boolean;
  onRequiredBusyChange?: (busy: boolean) => void;
}) {
  return (
    <AdminPhotoStrip
      itemId={itemId}
      photos={[]}
      alt=""
      required={required}
      onRequiredBusyChange={onRequiredBusyChange}
    />
  );
}
