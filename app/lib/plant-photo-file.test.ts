import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clientMimeWouldMismatchStagedTarget,
  filenameWithExtension,
  preparePlantPhotoFile,
  sniffImageKind,
} from "./plant-photo-file";

function jpegBytes(): Buffer {
  return Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
}

function pngBytes(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000002000100ffff03000006000557bf0000000049454e44ae426082",
    "hex",
  );
}

function heicHeader(): Buffer {
  return Buffer.from("000000186674797068656963000000006d696631", "hex");
}

describe("plant photo file preparation", () => {
  it("sniffs JPEG, PNG, and HEIC from magic bytes, not the client mime", () => {
    assert.equal(sniffImageKind(jpegBytes()), "jpeg");
    assert.equal(sniffImageKind(pngBytes()), "png");
    assert.equal(sniffImageKind(heicHeader()), "heic");
    assert.equal(sniffImageKind(Buffer.from("not-an-image")), "unknown");
  });

  it("treats a JPEG-labeled HEIC payload as a staged-target content-type mismatch", () => {
    assert.equal(
      clientMimeWouldMismatchStagedTarget("image/jpeg", sniffImageKind(heicHeader())),
      true,
    );
    assert.equal(clientMimeWouldMismatchStagedTarget("image/png", "png"), false);
    assert.equal(clientMimeWouldMismatchStagedTarget("image/jpeg", "jpeg"), false);
  });

  it("keeps PNG bytes and corrects the filename/mime for Shopify Files", async () => {
    const prepared = await preparePlantPhotoFile({
      filename: "leaf.HEIC",
      mimeType: "image/heic",
      data: pngBytes(),
    });
    assert.equal(prepared.mimeType, "image/png");
    assert.equal(prepared.filename, "leaf.png");
    assert.equal(sniffImageKind(prepared.data), "png");
  });

  it("converts HEIC bytes to JPEG before stagedUploadsCreate", async () => {
    const jpeg = jpegBytes();
    let converted = 0;
    const prepared = await preparePlantPhotoFile(
      {
        filename: "IMG_99.HEIC",
        mimeType: "image/heic",
        data: heicHeader(),
      },
      {
        convertHeic: async (data) => {
          converted += 1;
          assert.equal(sniffImageKind(data), "heic");
          return jpeg;
        },
      },
    );
    assert.equal(converted, 1);
    assert.equal(prepared.mimeType, "image/jpeg");
    assert.equal(prepared.filename, "IMG_99.jpg");
    assert.equal(sniffImageKind(prepared.data), "jpeg");
  });

  it("refuses unknown bytes instead of telling Shopify they are JPEG", async () => {
    await assert.rejects(
      () =>
        preparePlantPhotoFile({
          filename: "notes.txt",
          mimeType: "image/jpeg",
          data: Buffer.from("hello"),
        }),
      /not a JPEG, PNG, GIF, or WebP/,
    );
  });

  it("builds a Shopify-safe filename", () => {
    assert.equal(filenameWithExtension("My Plant!.HEIC", ".jpg"), "My-Plant-.jpg");
  });
});
