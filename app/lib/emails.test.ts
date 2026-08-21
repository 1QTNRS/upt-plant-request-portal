import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeResendError } from "./emails.server";

describe("Resend error reporting", () => {
  it("surfaces the message from a JSON error body", () => {
    const summary = summarizeResendError(
      422,
      JSON.stringify({ name: "validation_error", message: "Invalid `to` field." }),
    );
    assert.equal(summary, "Resend responded 422: validation_error: Invalid `to` field.");
  });

  it("points at domain verification on an unverified sending domain", () => {
    const summary = summarizeResendError(
      403,
      JSON.stringify({
        name: "validation_error",
        message: "The unsolicitedplanttalks.com domain is not verified.",
      }),
    );
    assert.match(summary, /not verified/);
    assert.match(summary, /Resend dashboard under Domains/);
  });

  it("falls back to the raw body when it is not JSON", () => {
    assert.equal(
      summarizeResendError(502, "Bad Gateway"),
      "Resend responded 502: Bad Gateway",
    );
  });

  it("truncates a very long body", () => {
    assert.ok(summarizeResendError(500, "x".repeat(5000)).length <= 1000);
  });
});
