import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isProduction } from "./env.server";

/**
 * Whether a failed Shopify Files upload may fall back to the local filesystem.
 *
 * Never in production. A photo on the container's disk disappears on the next
 * deploy and is invisible to every other instance, so the offer snapshot it was
 * frozen into would end up pointing at a dead URL. Failing the upload is
 * recoverable — a phantom photo is not.
 */
export function localUploadsAllowed(): boolean {
  return !isProduction();
}

export async function saveLocalUpload(
  shop: string,
  itemId: string,
  file: { filename: string; data: Buffer },
): Promise<string> {
  const safeShop = shop.replace(/[^a-zA-Z0-9.-]/g, "_");
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(process.cwd(), "public", "uploads", safeShop, itemId);
  await mkdir(dir, { recursive: true });
  const storedName = `${Date.now()}-${safeName}`;
  await writeFile(path.join(dir, storedName), file.data);
  return `/uploads/${safeShop}/${itemId}/${storedName}`;
}
