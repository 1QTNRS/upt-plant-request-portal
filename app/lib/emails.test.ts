import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseResendMessageId,
  resendSender,
  summarizeResendError,
} from "./emails.server";

type Call = { url: string; init: RequestInit };

/** Captures what the sender puts on the wire and replies with `body`. */
function stubFetch(
  reply: { status: number; body: string } | Error,
): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (reply instanceof Error) throw reply;
    return new Response(reply.body, { status: reply.status });
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchImpl };
}

const MESSAGE = {
  id: "email-row-1",
  from: "UPT <noreply@example.com>",
  toEmail: "buyer@example.com",
  subject: "Your UPT plant offer is ready (REQ4)",
  bodyText: "Review your offer: https://shop.example.com/apps/plant-requests",
};

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

describe("Resend message ids", () => {
  it("reads the id from a successful reply", () => {
    assert.equal(
      parseResendMessageId(JSON.stringify({ id: "3f7d-9a11" })),
      "3f7d-9a11",
    );
  });

  it("returns null rather than failing on a reply it cannot read", () => {
    assert.equal(parseResendMessageId("accepted"), null);
    assert.equal(parseResendMessageId("{}"), null);
    assert.equal(parseResendMessageId(JSON.stringify({ id: 7 })), null);
  });
});

describe("the Resend send request", () => {
  it("keys the request on the outbox row so a retry cannot double-send", async () => {
    const { calls, fetch } = stubFetch({
      status: 200,
      body: JSON.stringify({ id: "resend-1" }),
    });

    const result = await resendSender("re_test", fetch)(MESSAGE);

    assert.deepEqual(result, { ok: true, providerMessageId: "resend-1" });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], MESSAGE.id);
    assert.equal(headers.Authorization, "Bearer re_test");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      from: MESSAGE.from,
      to: [MESSAGE.toEmail],
      subject: MESSAGE.subject,
      text: MESSAGE.bodyText,
    });
  });

  it("gives up on a hung Resend rather than holding the caller open", async () => {
    const { calls, fetch } = stubFetch({ status: 200, body: "{}" });
    await resendSender("re_test", fetch)(MESSAGE);
    // The customer's plant request is already committed by the time this runs.
    assert.ok(calls[0].init.signal, "the send must carry an abort signal");
  });

  it("does not retry a send Resend will refuse again", async () => {
    const { fetch } = stubFetch({
      status: 403,
      body: JSON.stringify({
        name: "validation_error",
        message: "The example.com domain is not verified.",
      }),
    });

    const result = await resendSender("re_test", fetch)(MESSAGE);
    assert.equal(result.ok, false);
    assert.equal("retryable" in result && result.retryable, false);
    assert.match("error" in result ? result.error : "", /not verified/);
  });

  it("retries a rate limit or a Resend outage", async () => {
    for (const status of [429, 500, 503]) {
      const { fetch } = stubFetch({ status, body: "busy" });
      const result = await resendSender("re_test", fetch)(MESSAGE);
      assert.equal("retryable" in result && result.retryable, true, `status ${status}`);
    }
  });

  it("treats a timeout as retryable, since Resend may have accepted it", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const { fetch } = stubFetch(timeout);

    const result = await resendSender("re_test", fetch)(MESSAGE);
    assert.equal(result.ok, false);
    assert.equal("retryable" in result && result.retryable, true);
  });
});
