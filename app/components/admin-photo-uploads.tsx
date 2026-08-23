import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import {
  enqueuePhotoUploads,
  markPhotoUploadFailure,
  markPhotoUploadProgress,
  markPhotoUploadSuccess,
  photoUploadProgressLabel,
  retryPhotoUpload,
  sendOfferBlockedByRequiredPhotoUploads,
  type PhotoUploadEntry,
} from "../lib/admin-photo-upload";

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

export function AdminPhotoUploader({
  itemId,
  required,
  onRequiredBusyChange,
}: {
  itemId: string;
  required: boolean;
  onRequiredBusyChange?: (busy: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const [uploads, setUploads] = useState<PhotoUploadEntry[]>([]);
  const [jsReady, setJsReady] = useState(false);
  const filesByKey = useRef(new Map<string, File>());
  const inFlight = useRef(new Set<string>());
  const onBusyRef = useRef(onRequiredBusyChange);
  onBusyRef.current = onRequiredBusyChange;

  useEffect(() => {
    setJsReady(true);
  }, []);

  useEffect(() => {
    onBusyRef.current?.(
      sendOfferBlockedByRequiredPhotoUploads(uploads, required),
    );
  }, [uploads, required]);

  const startUpload = (key: string) => {
    const file = filesByKey.current.get(key);
    if (!file || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setUploads((current) => markPhotoUploadProgress(current, key, 0));

    const body = new FormData();
    body.set("intent", "upload-photo");
    body.set("itemId", itemId);
    body.set("photo", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${window.location.pathname}${window.location.search}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = (event.loaded / event.total) * 100;
      setUploads((current) => markPhotoUploadProgress(current, key, percent));
    };
    xhr.onload = () => {
      inFlight.current.delete(key);
      if (xhr.status >= 200 && xhr.status < 400) {
        setUploads((current) => markPhotoUploadSuccess(current, key));
        filesByKey.current.delete(key);
        revalidator.revalidate();
        return;
      }
      setUploads((current) =>
        markPhotoUploadFailure(
          current,
          key,
          xhr.statusText || "Upload failed",
        ),
      );
    };
    xhr.onerror = () => {
      inFlight.current.delete(key);
      setUploads((current) =>
        markPhotoUploadFailure(current, key, "Upload failed"),
      );
    };
    xhr.send(body);
  };

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
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
      if (started.includes(key)) filesByKey.current.set(key, file);
    }
    setUploads(next);
    for (const key of started) startUpload(key);
    event.currentTarget.value = "";
  };

  return (
    <div data-admin-photo-uploader>
      {uploads.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 8,
          }}
        >
          {uploads.map((upload) => {
            const file = filesByKey.current.get(upload.key);
            const preview = file ? URL.createObjectURL(file) : "";
            return (
              <div
                key={upload.key}
                data-pending-photo={upload.key}
                style={{ width: 120 }}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt={upload.name}
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
                <PhotoUploadProgress
                  percent={upload.progress}
                  status={upload.status}
                  error={upload.error}
                  onRetry={
                    upload.status === "error"
                      ? () => {
                          setUploads((current) => retryPhotoUpload(current, upload.key));
                          startUpload(upload.key);
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      ) : null}
      <input
        type="file"
        name="photo"
        accept="image/*"
        multiple
        onChange={jsReady ? handleSelect : undefined}
      />
      {jsReady ? null : (
        <s-button variant="secondary" type="submit">
          Upload plant photo
        </s-button>
      )}
    </div>
  );
}
