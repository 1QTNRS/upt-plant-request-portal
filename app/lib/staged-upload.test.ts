import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STAGED_UPLOAD_HTTP_METHOD,
  STAGED_UPLOAD_RESOURCE,
  logStagedUploadFailure,
  postFileToStagedTarget,
  sanitizeStagedUploadBody,
  sanitizeStagedUploadUrl,
  stagedTargetErrorMessage,
  stagedUploadFormEntries,
} from "./staged-upload";

const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

const target = {
  url: "https://shopify-staged-uploads.storage.googleapis.com/upload?X-Goog-Signature=supersecret",
  resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/photo.jpg",
  parameters: [
    { name: "key", value: "tmp/photo.jpg" },
    { name: "content_type", value: "image/jpeg" },
    { name: "success_action_status", value: "201" },
    { name: "policy", value: "signed-policy" },
    { name: "x-goog-signature", value: "abc123signature" },
  ],
};

describe("Shopify staged-target POST", () => {
  it("requests POST + FILE and appends every parameter before the file part", () => {
    assert.equal(STAGED_UPLOAD_HTTP_METHOD, "POST");
    assert.equal(STAGED_UPLOAD_RESOURCE, "FILE");
    assert.deepEqual(
      stagedUploadFormEntries(target, {
        filename: "plant.jpg",
        mimeType: "image/jpeg",
        data: jpeg,
      }).map((entry) => entry.name),
      ["key", "content_type", "success_action_status", "policy", "x-goog-signature", "file"],
    );
  });

  it("posts multipart without overriding the boundary and succeeds on 201", async () => {
    let method = "";
    let headerType = "";
    const sent: string[] = [];
    await postFileToStagedTarget({
      shop: "demo.myshopify.com",
      target,
      file: { filename: "plant.jpg", mimeType: "image/jpeg", data: jpeg },
      fetchImpl: async (url, init) => {
        assert.equal(sanitizeStagedUploadUrl(url), "https://shopify-staged-uploads.storage.googleapis.com/upload");
        method = init.method;
        const request = new Request(url, { method: init.method, body: init.body });
        headerType = request.headers.get("content-type") || "";
        const form = await request.formData();
        for (const [key] of form.entries()) sent.push(key);
        const file = form.get("file");
        assert.ok(file instanceof File);
        assert.equal(file.name, "plant.jpg");
        assert.equal(file.type, "image/jpeg");
        assert.equal(file.size, jpeg.length);
        return new Response(null, { status: 201 });
      },
    });
    assert.equal(method, "POST");
    assert.match(headerType, /^multipart\/form-data; boundary=/);
    assert.ok(!headerType.includes("application/json"));
    assert.deepEqual(sent, [
      "key",
      "content_type",
      "success_action_status",
      "policy",
      "x-goog-signature",
      "file",
    ]);
  });

  it("includes every Shopify parameter so a missing field cannot come from our POST", () => {
    const names = stagedUploadFormEntries(target, {
      filename: "plant.jpg",
      mimeType: "image/jpeg",
      data: jpeg,
    }).map((entry) => entry.name);
    for (const parameter of target.parameters) {
      assert.ok(names.includes(parameter.name), `missing ${parameter.name}`);
    }
    assert.equal(names.at(-1), "file");
  });

  it("includes status and a sanitized body on a non-2xx staged-target response", async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await assert.rejects(
        () =>
          postFileToStagedTarget({
            shop: "demo.myshopify.com",
            target,
            file: { filename: "plant.jpg", mimeType: "image/jpeg", data: jpeg },
            fetchImpl: async () =>
              new Response(
                `<Error><Code>InvalidArgument</Code><Message>Content-Type does not match</Message><Signature>AAAA${"B".repeat(40)}</Signature></Error>`,
                { status: 400 },
              ),
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /400 at staged-target/);
          assert.match(error.message, /InvalidArgument/);
          assert.doesNotMatch(error.message, /X-Goog-Signature=supersecret/);
          assert.doesNotMatch(error.message, /BBBBBBBBBB/);
          return true;
        },
      );
    } finally {
      console.error = original;
    }
    assert.match(errors.join("\n"), /stage=staged-target status=400/);
    assert.doesNotMatch(errors.join("\n"), /X-Goog-Signature=supersecret/);
  });

  it("redacts signed staged-upload URLs and long signatures", () => {
    assert.equal(
      sanitizeStagedUploadUrl(target.url),
      "https://shopify-staged-uploads.storage.googleapis.com/upload",
    );
    const body = sanitizeStagedUploadBody(
      `see ${target.url} x-goog-signature=abcd${"e".repeat(40)}`,
    );
    assert.doesNotMatch(body, /supersecret/);
    assert.doesNotMatch(body, /x-goog-signature=abcd/);
    const message = stagedTargetErrorMessage({
      stage: "staged-target",
      status: 403,
      body: `token=shpss_${"a".repeat(24)}`,
    });
    assert.match(message, /403 at staged-target/);
    assert.match(message, /shpss_\[redacted\]/);
    assert.doesNotMatch(message, /aaaaaaaaaaaaaaaaaaaaaaaa/);
  });

  it("does not log the raw signed URL", () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      logStagedUploadFailure({
        shop: "demo.myshopify.com",
        stage: "staged-target",
        status: 400,
        url: target.url,
        body: "ok",
      });
    } finally {
      console.error = original;
    }
    assert.doesNotMatch(errors.join("\n"), /supersecret/);
    assert.match(errors.join("\n"), /shopify-staged-uploads\.storage\.googleapis\.com\/upload/);
  });
});
