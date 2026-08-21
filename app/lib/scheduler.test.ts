import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cronSecretMatches, readCronSecret } from "./scheduler.server";

describe("cron secret comparison", () => {
  it("accepts the configured secret", () => {
    assert.equal(cronSecretMatches("s3cret", "s3cret"), true);
  });

  it("rejects a wrong secret", () => {
    assert.equal(cronSecretMatches("wrong", "s3cret"), false);
  });

  it("rejects a secret of a different length without leaking it", () => {
    assert.equal(cronSecretMatches("s3cretttttt", "s3cret"), false);
    assert.equal(cronSecretMatches("s3c", "s3cret"), false);
  });

  it("rejects a missing header", () => {
    assert.equal(cronSecretMatches(null, "s3cret"), false);
    assert.equal(cronSecretMatches(undefined, "s3cret"), false);
    assert.equal(cronSecretMatches("", "s3cret"), false);
  });

  it("rejects everything when no secret is configured", () => {
    assert.equal(cronSecretMatches("anything", undefined), false);
    assert.equal(cronSecretMatches("anything", ""), false);
  });
});

describe("cron secret extraction", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("https://portal.example.com/cron/offer-maintenance", {
      method: "POST",
      headers,
    });
  }

  it("reads a bearer token", () => {
    assert.equal(
      readCronSecret(requestWith({ Authorization: "Bearer s3cret" })),
      "s3cret",
    );
  });

  it("accepts a lowercase bearer scheme", () => {
    assert.equal(
      readCronSecret(requestWith({ Authorization: "bearer s3cret" })),
      "s3cret",
    );
  });

  it("reads the X-Cron-Secret header", () => {
    assert.equal(readCronSecret(requestWith({ "X-Cron-Secret": "s3cret" })), "s3cret");
  });

  it("returns null when neither header is present", () => {
    assert.equal(readCronSecret(requestWith({})), null);
  });

  it("does not read the secret from the query string", () => {
    const request = new Request(
      "https://portal.example.com/cron/offer-maintenance?secret=s3cret",
      { method: "POST" },
    );
    assert.equal(readCronSecret(request), null);
  });
});
