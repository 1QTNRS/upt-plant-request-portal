import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const splashPath = path.join(import.meta.dirname, "..", "assets", "splash-icon.png");

function pngRgba(file: Buffer): { width: number; height: number; pixels: Buffer } {
  assert.deepEqual([...file.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString("ascii");
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, "splash-icon.png must be 8-bit RGBA");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = raw.subarray(src, src + stride);
    src += stride;
    const dest = pixels.subarray(y * stride, (y + 1) * stride);
    if (filter === 0) {
      row.copy(dest);
    } else if (filter === 1) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 4 ? dest[i - 4] : 0;
        dest[i] = (row[i] + left) & 255;
      }
    } else if (filter === 2) {
      const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
      for (let i = 0; i < stride; i += 1) {
        dest[i] = (row[i] + (prev ? prev[i] : 0)) & 255;
      }
    } else if (filter === 3) {
      const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 4 ? dest[i - 4] : 0;
        const up = prev ? prev[i] : 0;
        dest[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
      }
    } else if (filter === 4) {
      const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
      for (let i = 0; i < stride; i += 1) {
        const a = i >= 4 ? dest[i - 4] : 0;
        const b = prev ? prev[i] : 0;
        const c = i >= 4 && prev ? prev[i - 4] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        dest[i] = (row[i] + pr) & 255;
      }
    } else {
      assert.fail(`unsupported PNG filter ${filter}`);
    }
  }
  return { width, height, pixels };
}

describe("splash logo asset", () => {
  it("is a real mark with visible pixels, not a transparent placeholder", () => {
    const file = readFileSync(splashPath);
    assert.ok(file.length > 50_000, "store logo should be substantially larger than the old 4KB empty PNG");
    const { width, height, pixels } = pngRgba(file);
    assert.equal(width, 1024);
    assert.equal(height, 1024);
    let visible = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 16) visible += 1;
    }
    assert.ok(visible > 100_000, `expected a visible logo, found ${visible} opaque pixels`);
  });
});
