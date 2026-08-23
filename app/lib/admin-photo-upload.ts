/**
 * Pure helpers for admin exact-plant photo uploads: one queue entry per file,
 * independent progress, and no duplicate in-flight submissions.
 *
 * Transport progress is capped below 100. Hitting 100% on the wire only means
 * the request body left the browser — Shopify Files (or even the action) may
 * still be running. Completion is exclusively `markPhotoUploadSuccess` after
 * a parsed successful finalize payload.
 */

export type PhotoUploadStatus = "queued" | "uploading" | "success" | "error";

export type SavedPhotoRef = { id: string; url: string };

export type PhotoUploadEntry = {
  key: string;
  name: string;
  progress: number;
  status: PhotoUploadStatus;
  error?: string;
  photoId?: string;
  photoUrl?: string;
};

export type PhotoCard =
  | { kind: "saved"; photo: SavedPhotoRef; uploadKey?: string }
  | { kind: "pending"; upload: PhotoUploadEntry };

export const PHOTO_UPLOAD_TRANSPORT_CAP = 99;
export const PHOTO_UPLOAD_WATCHDOG_MS = 90_000;

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

/** Upload-body progress only. Never reports completion. */
export function transportProgressPercent(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(
    PHOTO_UPLOAD_TRANSPORT_CAP,
    Math.max(0, Math.round((loaded / total) * 100)),
  );
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
  const capped = Math.min(
    PHOTO_UPLOAD_TRANSPORT_CAP,
    Math.max(0, Math.round(percent)),
  );
  return entries.map((entry) =>
    entry.key === key && entry.status !== "success"
      ? {
          ...entry,
          status: "uploading",
          progress: capped,
        }
      : entry,
  );
}

export function markPhotoUploadSuccess(
  entries: PhotoUploadEntry[],
  key: string,
  photo?: SavedPhotoRef,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key
      ? {
          ...entry,
          status: "success",
          progress: 100,
          error: undefined,
          photoId: photo?.id ?? entry.photoId,
          photoUrl: photo?.url ?? entry.photoUrl,
        }
      : entry,
  );
}

export function markPhotoUploadFailure(
  entries: PhotoUploadEntry[],
  key: string,
  error: string,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key && entry.status !== "success"
      ? { ...entry, status: "error", error, progress: entry.progress }
      : entry,
  );
}

export function retryPhotoUpload(
  entries: PhotoUploadEntry[],
  key: string,
): PhotoUploadEntry[] {
  return entries.map((entry) =>
    entry.key === key && entry.status === "error"
      ? { ...entry, status: "queued", progress: 0, error: undefined }
      : entry,
  );
}

export function cancelPhotoUpload(
  entries: PhotoUploadEntry[],
  key: string,
): PhotoUploadEntry[] {
  return entries.filter((entry) => entry.key !== key);
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

export type ParsedUploadActionResponse =
  | { ok: true; photo: SavedPhotoRef; uploadKey?: string }
  | { ok: false; error: string };

/**
 * App Bridge on the embedded admin. `fetch` (React Router / useFetcher) gets a
 * session token automatically; raw XHR does not.
 */
export type EmbeddedAdminBridge = {
  ready?: Promise<void>;
  idToken?: () => Promise<string>;
};

export async function readEmbeddedAdminSessionToken(
  shopify?: EmbeddedAdminBridge | null,
): Promise<string | undefined> {
  if (!shopify || typeof shopify.idToken !== "function") return undefined;
  if (shopify.ready) {
    try {
      await shopify.ready;
    } catch {
      // idToken may still work after ready rejects.
    }
  }
  try {
    const token = (await shopify.idToken()).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function adminPhotoUploadHeaders(
  token?: string,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function applyAdminPhotoUploadHeaders(
  xhr: { setRequestHeader: (name: string, value: string) => void },
  token?: string,
): void {
  for (const [name, value] of Object.entries(adminPhotoUploadHeaders(token))) {
    xhr.setRequestHeader(name, value);
  }
}

export function describeUnreadableUploadResponse(body: string): string {
  const text = body.trim();
  if (!text) return "Empty upload response.";
  if (text === "Bad Request") {
    return "Upload was rejected. Reload the page and try again.";
  }
  if (/<!doctype html/i.test(text) || /<html[\s>]/i.test(text)) {
    return "Could not complete the upload. Reload the page and try again.";
  }
  return "Could not read the upload response.";
}

/** Maps a thrown bounce/redirect Response into a JSON body the XHR client can read. */
export function photoUploadThrownErrorPayload(
  error: unknown,
): { error: string; status: number } | null {
  if (error instanceof Response) {
    const contentType = error.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return null;
    return {
      error: "Could not complete the upload. Reload the page and try again.",
      status: error.status >= 400 ? error.status : 401,
    };
  }
  return {
    error: error instanceof Error ? error.message : "Upload failed.",
    status: 500,
  };
}

/**
 * Accepts the JSON resource-route body, or a React Router single-fetch
 * turbo-stream leftover. The body must be fully read before this is called.
 */
export function parseUploadActionResponse(
  body: string,
): ParsedUploadActionResponse {
  const text = body.trim();
  if (!text) return { ok: false, error: "Empty upload response." };

  try {
    const parsed = JSON.parse(text) as {
      ok?: unknown;
      photo?: { id?: unknown; url?: unknown };
      error?: unknown;
      uploadKey?: unknown;
    };
    if (parsed && parsed.ok === true && parsed.photo?.id && parsed.photo?.url) {
      return {
        ok: true,
        photo: { id: String(parsed.photo.id), url: String(parsed.photo.url) },
        uploadKey:
          typeof parsed.uploadKey === "string" ? parsed.uploadKey : undefined,
      };
    }
    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        error:
          typeof parsed.error === "string" && parsed.error
            ? parsed.error
            : "Upload failed.",
      };
    }
  } catch {
    // Fall through to the turbo-stream walk.
  }

  if (/"ok"\s*,\s*true/.test(text) || /"ok":true/.test(text)) {
    const id = text.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
    const url = text.match(/"url"\s*:\s*"([^"]+)"/)?.[1];
    if (id && url) return { ok: true, photo: { id, url } };
    return { ok: false, error: "Upload response did not include the saved photo." };
  }
  if (/"ok"\s*,\s*false/.test(text) || /"ok":false/.test(text)) {
    const error = text.match(/"error"\s*:\s*"([^"]+)"/)?.[1];
    return { ok: false, error: error || "Upload failed." };
  }

  return { ok: false, error: describeUnreadableUploadResponse(text) };
}

/**
 * One card per photo: saved server photos first (minus any still represented
 * by a local success entry), then local queued/uploading/error/success cards.
 * A finalized local entry that already has a photoId is the same card as the
 * server row — it is not rendered twice.
 */
export function mergePhotoCards(
  serverPhotos: SavedPhotoRef[],
  uploads: PhotoUploadEntry[],
): PhotoCard[] {
  const localPhotoIds = new Set(
    uploads.map((entry) => entry.photoId).filter((id): id is string => Boolean(id)),
  );
  const cards: PhotoCard[] = [];
  for (const photo of serverPhotos) {
    if (localPhotoIds.has(photo.id)) continue;
    cards.push({ kind: "saved", photo });
  }
  for (const upload of uploads) {
    if (upload.status === "success" && upload.photoId) {
      cards.push({
        kind: "saved",
        photo: {
          id: upload.photoId,
          url: upload.photoUrl || serverPhotos.find((photo) => photo.id === upload.photoId)?.url || "",
        },
        uploadKey: upload.key,
      });
      continue;
    }
    cards.push({ kind: "pending", upload });
  }
  return cards;
}

/** Drop local success rows once the loader has the same photo id. */
export function dropReconciledUploads(
  uploads: PhotoUploadEntry[],
  serverPhotos: SavedPhotoRef[],
): PhotoUploadEntry[] {
  const saved = new Set(serverPhotos.map((photo) => photo.id));
  return uploads.filter((entry) => {
    if (entry.status === "success" && entry.photoId && saved.has(entry.photoId)) {
      return false;
    }
    return true;
  });
}
