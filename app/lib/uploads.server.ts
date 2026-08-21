import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


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
