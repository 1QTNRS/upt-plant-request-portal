/**
 * Pure helpers for admin exact-plant photo uploads: one queue entry per file,
 * independent progress, and no duplicate in-flight submissions.
 */

export type PhotoUploadStatus = "queued" | "uploading" | "success" | "error";

export type PhotoUploadEntry = {
  key: string;
  name: string;
  progress: number;
  status: PhotoUploadStatus;
  error?: string;
};

export function photoUploadKey(file: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function photoUploadProgressLabel(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `${clamped}%`;
}

export function enqueuePhotoUploads(
  existing: PhotoUploadEntry[],
  files: Array<{ name: string; size: number; lastModified: number }>,
): { next: PhotoUploadEntry[]; started: string[] } {
  const known = new Set(existing.map((entry) => entry.key));
  const started: string[] = [];
  const next = [...existing];
  for (const file of files) {
    const key = photoUploadKey(file);
    if (known.has(key)) continue;
    known.add(key);
    next.push({
      key,
      name: file.name,
      progress: 0,
      status: "queued",
    });
    started.push(key);
  }
  return { next, started };
}

export function markPhotoUploadProgress(
  entries: PhotoUploadEntry[],
  key: string,
  percent: number,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key
      ? {
          ...entry,
          status: "uploading",
          progress: Math.max(0, Math.min(100, Math.round(percent))),
        }
      : entry,
  );
}

export function markPhotoUploadSuccess(
  entries: PhotoUploadEntry[],
  key: string,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key
      ? { ...entry, status: "success", progress: 100, error: undefined }
      : entry,
  );
}

export function markPhotoUploadFailure(
  entries: PhotoUploadEntry[],
  key: string,
  error: string,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key
      ? { ...entry, status: "error", error, progress: entry.progress }
      : entry,
  );
}

export function retryPhotoUpload(
  entries: PhotoUploadEntry[],
  key: string,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key
      ? { ...entry, status: "queued", progress: 0, error: undefined }
      : entry,
  );
}

/** Required exact-plant photos still moving through the queue block Send Offer. */
export function sendOfferBlockedByRequiredPhotoUploads(
  entries: PhotoUploadEntry[],
  required: boolean,
): boolean {
  if (!required) return false;
  return entries.some(
    (entry) => entry.status === "queued" || entry.status === "uploading",
  );
}
