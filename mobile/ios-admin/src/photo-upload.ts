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

export type PhotoLibraryPermission = {
  granted: boolean;
};

export type ImageLibraryPickResult = {
  canceled: boolean;
  assets?: PickerAsset[] | null;
};

/** PHPicker options: JPEG-compatible files in cache, no prior library grant. */
export const IMAGE_LIBRARY_PICKER_OPTIONS: {
  mediaTypes: Array<"images">;
  quality: number;
  allowsMultipleSelection: boolean;
  orderedSelection: boolean;
  preferredAssetRepresentationMode: "compatible";
} = {
  mediaTypes: ["images"],
  quality: 0.8,
  allowsMultipleSelection: true,
  orderedSelection: true,
  preferredAssetRepresentationMode: "compatible",
};

export const PHOTO_LIBRARY_DENIED_MESSAGE =
  "Photo library access is needed to attach an exact-plant photo.";

export function newPhotoClientKey(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shouldBlockLibraryPicker(_permission: PhotoLibraryPermission | null): boolean {
  // iOS 14+ PHPicker does not need a prior grant. Blocking on Expo Go's
  // library permission was preventing the system picker from opening at all.
  return false;
}

export function normalizedImageMime(asset: PickerAsset): string {
  const mime = (asset.mimeType || "").toLowerCase();
  const name = asset.fileName || "";
  if (mime === "image/png" || /\.png$/i.test(name)) return "image/png";
  if (mime === "image/webp" || /\.webp$/i.test(name)) return "image/webp";
  if (mime === "image/gif" || /\.gif$/i.test(name)) return "image/gif";
  return "image/jpeg";
}

export function uploadFileFromPickerAsset(
  asset: PickerAsset,
  index: number,
): { uri: string; name: string; type: string } {
  const type = normalizedImageMime(asset);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
  const rawBase = (asset.fileName || `plant-${index + 1}`).replace(/\.[^.]+$/, "");
  const base = rawBase.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || `plant-${index + 1}`;
  return { uri: asset.uri, name: `${base}.${ext}`, type };
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
      file: uploadFileFromPickerAsset(asset, index),
    };
  });
}

export function photoPickerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/permission|denied|access/i.test(message)) return PHOTO_LIBRARY_DENIED_MESSAGE;
  return message || "Could not open the photo library.";
}

export async function pickPlantPhotos(input: {
  launch: (options: typeof IMAGE_LIBRARY_PICKER_OPTIONS) => Promise<ImageLibraryPickResult>;
  requestPermission?: () => Promise<PhotoLibraryPermission>;
}): Promise<{ canceled: boolean; assets: PickerAsset[] }> {
  const options = IMAGE_LIBRARY_PICKER_OPTIONS;
  try {
    const first = await input.launch(options);
    if (first.canceled || !first.assets?.length) return { canceled: true, assets: [] };
    return { canceled: false, assets: first.assets };
  } catch (error) {
    if (!input.requestPermission) throw error;
    const permission = await input.requestPermission();
    if (!permission.granted) {
      throw new Error(PHOTO_LIBRARY_DENIED_MESSAGE);
    }
    const retry = await input.launch(options);
    if (retry.canceled || !retry.assets?.length) return { canceled: true, assets: [] };
    return { canceled: false, assets: retry.assets };
  }
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
