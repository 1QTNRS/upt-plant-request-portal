import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  clearFinalizedPhotoUploads,
  saveUploadedPlantPhoto,
} from "./photo-upload.server";
import { getRequest, submitCustomerRequest } from "./portal.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-photo-upload-test`;

async function purge() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  clearFinalizedPhotoUploads();
}

async function newRequest() {
  return submitCustomerRequest(shop, {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    items: [{ plantName: "Pink Princess" }],
  });
}

function pngBytes(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000002000100ffff03000006000557bf0000000049454e44ae426082",
    "hex",
  );
}

describe("plant photo upload finalize", () => {
  before(purge);
  after(purge);

  it("retries after a successful finalize reuse the same photo record", async () => {
    const created = await newRequest();
    const itemId = created.items[0].id;
    const file = {
      filename: "front.png",
      mimeType: "image/png",
      data: pngBytes(),
    };

    const first = await saveUploadedPlantPhoto({
      shop,
      admin: undefined,
      requestId: created.id,
      itemId,
      clientKey: "front.png:12:1",
      file,
    });
    const second = await saveUploadedPlantPhoto({
      shop,
      admin: undefined,
      requestId: created.id,
      itemId,
      clientKey: "front.png:12:1",
      file,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.photo.id, second.photo.id);

    const request = await getRequest(shop, created.id);
    const photos = request?.items.find((item) => item.id === itemId)?.photos ?? [];
    assert.equal(photos.length, 1);
  });

  it("finishes two simultaneous files independently without duplicating either", async () => {
    const created = await newRequest();
    const itemId = created.items[0].id;
    const [one, two] = await Promise.all([
      saveUploadedPlantPhoto({
        shop,
        admin: undefined,
        requestId: created.id,
        itemId,
        clientKey: "a.png:1:1",
        file: { filename: "a.png", mimeType: "image/png", data: pngBytes() },
      }),
      saveUploadedPlantPhoto({
        shop,
        admin: undefined,
        requestId: created.id,
        itemId,
        clientKey: "b.png:1:2",
        file: {
          filename: "b.png",
          mimeType: "image/png",
          data: Buffer.concat([pngBytes(), Buffer.from("b")]),
        },
      }),
    ]);
    assert.equal(one.ok, true);
    assert.equal(two.ok, true);
    if (!one.ok || !two.ok) return;
    assert.notEqual(one.photo.id, two.photo.id);

    const request = await getRequest(shop, created.id);
    const photos = request?.items.find((item) => item.id === itemId)?.photos ?? [];
    assert.equal(photos.length, 2);
  });
});
