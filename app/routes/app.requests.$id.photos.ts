import type { ActionFunctionArgs } from "react-router";

import { requireAdmin } from "../lib/admin-auth.server";
import { photoUploadThrownErrorPayload } from "../lib/admin-photo-upload";
import { saveUploadedPlantPhoto } from "../lib/photo-upload.server";

function jsonUploadError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function asJsonUploadFailure(error: unknown) {
  const payload = photoUploadThrownErrorPayload(error);
  if (!payload && error instanceof Response) return error;
  if (!payload) return jsonUploadError("Upload failed.", 500);
  return jsonUploadError(payload.error, payload.status);
}

/**
 * JSON-only photo upload. The request-detail `.data` document action streams
 * the rest of the page loaders after the mutation, so an XHR waiting on that
 * response could sit at transport-complete (100%) until those loaders finished
 * — or forever, if a loader hung.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { shop, admin } = await requireAdmin(request);
    const requestId = params.id ?? "";
    const form = await request.formData();
    const itemId = String(form.get("itemId") || "");
    const upload = form.get("photo");
    const clientKey = String(form.get("uploadKey") || "");

    if (!(upload instanceof File) || upload.size <= 0) {
      return jsonUploadError("Choose a photo to upload.", 400);
    }

    const result = await saveUploadedPlantPhoto({
      shop,
      admin,
      requestId,
      itemId,
      clientKey,
      file: {
        filename: upload.name,
        mimeType: upload.type || "image/jpeg",
        data: Buffer.from(await upload.arrayBuffer()),
      },
    });

    if (!result.ok) {
      return jsonUploadError(result.error, 400);
    }

    return Response.json({
      ok: true,
      photo: result.photo,
      uploadKey: clientKey || undefined,
    });
  } catch (error) {
    return asJsonUploadFailure(error);
  }
};
