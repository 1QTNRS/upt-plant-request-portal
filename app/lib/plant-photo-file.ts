export type PlantPhotoFile = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export type SniffedImageKind = "jpeg" | "png" | "gif" | "webp" | "heic" | "unknown";

const SHOPIFY_IMAGE_MIME: Record<Exclude<SniffedImageKind, "heic" | "unknown">, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const HEIC_BRANDS = new Set(["heic", "heix", "heif", "hevc", "hevx", "mif1", "msf1"]);

export function sniffImageKind(data: Buffer): SniffedImageKind {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return "png";
  }
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return "gif";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp") {
    const brand = data.toString("ascii", 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  return "unknown";
}

export function extensionForImageKind(kind: Exclude<SniffedImageKind, "unknown">): string {
  if (kind === "jpeg" || kind === "heic") return ".jpg";
  if (kind === "png") return ".png";
  if (kind === "gif") return ".gif";
  return ".webp";
}

export function filenameWithExtension(filename: string, extension: string): string {
  const trimmed = filename.trim() || "plant";
  const base = trimmed.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "plant";
  return `${base}${extension}`;
}

export function clientMimeWouldMismatchStagedTarget(
  clientMime: string,
  kind: SniffedImageKind,
): boolean {
  const mime = clientMime.toLowerCase();
  if (kind === "heic") return mime === "image/jpeg" || mime === "image/jpg" || mime === "image/png";
  if (kind === "unknown") return false;
  return mime !== SHOPIFY_IMAGE_MIME[kind] && mime !== "image/jpg";
}

export async function convertHeicToJpeg(data: Buffer): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  const output = await convert({ buffer: data, format: "JPEG", quality: 0.8 });
  return Buffer.from(output);
}

export async function preparePlantPhotoFile(
  file: PlantPhotoFile,
  options?: { convertHeic?: (data: Buffer) => Promise<Buffer> },
): Promise<PlantPhotoFile> {
  const kind = sniffImageKind(file.data);
  if (kind === "unknown") {
    throw new Error(
      "That file is not a JPEG, PNG, GIF, or WebP photo Shopify Files can store.",
    );
  }
  if (kind === "heic") {
    const convert = options?.convertHeic ?? convertHeicToJpeg;
    const jpeg = await convert(file.data);
    if (sniffImageKind(jpeg) !== "jpeg") {
      throw new Error("Could not convert this iPhone HEIC photo to JPEG.");
    }
    return {
      filename: filenameWithExtension(file.filename, ".jpg"),
      mimeType: "image/jpeg",
      data: jpeg,
    };
  }
  return {
    filename: filenameWithExtension(file.filename, extensionForImageKind(kind)),
    mimeType: SHOPIFY_IMAGE_MIME[kind],
    data: file.data,
  };
}
