import { createHash } from "node:crypto";

import type { AdminContext } from "./admin-auth.server";
import { canStubShopifyWrites } from "./environment.server";
import { addItemPhotos, getRequest } from "./portal.server";
import { uploadPlantPhoto } from "./shopify-ops.server";
import { saveLocalUpload } from "./uploads.server";

type GraphqlClient = NonNullable<AdminContext["admin"]>;

export type SavedPlantPhoto = {
  id: string;
  url: string;
  shopifyFileId?: string;
};

/**
 * In-process map so a retry after the server already finalized does not create
 * a second Shopify file or PhotoReference. Render has one web process; a
 * refresh does not replay the XHR, so this covers the false-timeout retry.
 */
const finalizedUploads = new Map<string, SavedPlantPhoto>();

export function photoUploadMemoryKey(input: {
  shop: string;
  requestId: string;
  itemId: string;
  clientKey: string;
}): string {
  return `${input.shop}:${input.requestId}:${input.itemId}:${input.clientKey}`;
}

export function rememberFinalizedPhotoUpload(
  key: string,
  photo: SavedPlantPhoto,
): void {
  finalizedUploads.set(key, photo);
}

export function peekFinalizedPhotoUpload(key: string): SavedPlantPhoto | undefined {
  return finalizedUploads.get(key);
}

export function clearFinalizedPhotoUploads(): void {
  finalizedUploads.clear();
}

function contentKey(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function findPhotoByUrl(
  request: Awaited<ReturnType<typeof getRequest>>,
  itemId: string,
  url: string,
): SavedPlantPhoto | null {
  const photos = request?.items.find((item) => item.id === itemId)?.photos ?? [];
  const match = photos.find((photo) => photo.url === url);
  if (!match) return null;
  return { id: match.id, url: match.url };
}

export async function saveUploadedPlantPhoto(input: {
  shop: string;
  admin: GraphqlClient | undefined;
  requestId: string;
  itemId: string;
  file: { filename: string; mimeType: string; data: Buffer };
  clientKey?: string;
}): Promise<{ ok: true; photo: SavedPlantPhoto } | { ok: false; error: string }> {
  const clientKey = input.clientKey?.trim() || contentKey(input.file.data);
  const memoryKey = photoUploadMemoryKey({
    shop: input.shop,
    requestId: input.requestId,
    itemId: input.itemId,
    clientKey,
  });
  const remembered = finalizedUploads.get(memoryKey);
  if (remembered) return { ok: true, photo: remembered };

  try {
    let stored: { url: string; shopifyFileId?: string };
    try {
      stored = await uploadPlantPhoto(input.admin, input.shop, input.file);
    } catch (error) {
      if (!canStubShopifyWrites(input.shop)) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not upload the photo to Shopify Files.",
        };
      }
      stored = {
        url: await saveLocalUpload(input.shop, input.itemId, {
          filename: input.file.filename,
          data: input.file.data,
        }),
      };
    }

    const after = await addItemPhotos(input.shop, input.requestId, input.itemId, [
      stored,
    ]);
    const photo = findPhotoByUrl(after, input.itemId, stored.url);
    if (!photo) {
      return { ok: false, error: "The photo was stored but could not be attached." };
    }
    finalizedUploads.set(memoryKey, photo);
    return { ok: true, photo };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Upload failed.",
    };
  }
}
