export const PHOTO_UPLOAD_CONCURRENCY = 3;

export type PhotoUploadStatus = "uploading" | "ready" | "failed";

export type EditorPhoto = {
  id: string;
  url: string;
  status: PhotoUploadStatus;
  progress: number;
  clientKey?: string;
  file?: { uri: string; name: string; type: string };
};

export type PickerAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function newPhotoClientKey(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function photosFromPickerAssets(assets: PickerAsset[]): EditorPhoto[] {
  return assets.map((asset, index) => {
    const clientKey = `${newPhotoClientKey()}-${index}`;
    return {
      id: clientKey,
      url: asset.uri,
      status: "uploading" as const,
      progress: 0,
      clientKey,
      file: {
        uri: asset.uri,
        name: asset.fileName || `plant-${index + 1}.jpg`,
        type: asset.mimeType || "image/jpeg",
      },
    };
  });
}

export function mergeEditorPhotos(
  serverPhotos: Array<{ id: string; url: string }>,
  pending: EditorPhoto[],
): EditorPhoto[] {
  const ready = serverPhotos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    status: "ready" as const,
    progress: 1,
  }));
  const stillPending = pending.filter((photo) => photo.status !== "ready");
  return [...ready, ...stillPending];
}

export function canPreviewPhoto(photo: Pick<EditorPhoto, "status">): boolean {
  return photo.status === "ready";
}

export function canReorderPhoto(photo: Pick<EditorPhoto, "id" | "status">): boolean {
  return photo.status === "ready" && photo.id !== "linked-stock";
}

export function showsProgressBar(photo: Pick<EditorPhoto, "status">): boolean {
  return photo.status === "uploading";
}

export function showsRetry(photo: Pick<EditorPhoto, "status">): boolean {
  return photo.status === "failed";
}

export function stripPhotoChanged(
  current: Pick<EditorPhoto, "id" | "url" | "status" | "progress">,
  next: Pick<EditorPhoto, "id" | "url" | "status" | "progress">,
): boolean {
  return (
    current.id !== next.id ||
    current.url !== next.url ||
    current.status !== next.status ||
    current.progress !== next.progress
  );
}

export function shouldReplaceStripOrder(
  current: Array<Pick<EditorPhoto, "id" | "url" | "status" | "progress">>,
  next: Array<Pick<EditorPhoto, "id" | "url" | "status" | "progress">>,
): boolean {
  if (current === next) return false;
  if (current.length !== next.length) return true;
  return current.some((photo, index) => stripPhotoChanged(photo, next[index]));
}

export function mountPhotoStrip(
  propsList: Array<{ photos: EditorPhoto[] }>,
): { setStateCalls: number; renderCount: number; order: EditorPhoto[] } {
  const initial = propsList[0]?.photos ?? [];
  let order = initial;
  let setStateCalls = 0;
  let renderCount = 0;
  const limit = Math.max(propsList.length * 4, 50);
  for (const props of propsList) {
    renderCount += 1;
    if (setStateCalls > limit) {
      throw new Error("Maximum update depth exceeded");
    }
    if (shouldReplaceStripOrder(order, props.photos)) {
      setStateCalls += 1;
      order = props.photos;
      renderCount += 1;
    }
  }
  return { setStateCalls, renderCount, order };
}

export function orderedPhotoIdsAfterUpload(
  keptIds: string[],
  pickedClientKeys: string[],
  uploadedByKey: Map<string, string>,
): string[] {
  const seen = new Set(keptIds);
  const added = pickedClientKeys
    .map((key) => uploadedByKey.get(key))
    .filter((id): id is string => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return [...keptIds, ...added];
}

export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next !== undefined) await worker(next);
    }
  });
  await Promise.all(workers);
}
