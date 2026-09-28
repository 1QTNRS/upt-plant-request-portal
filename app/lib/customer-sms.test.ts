import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  normalizeSmsPhone,
  readSmsNotifyEnabled,
  readSmsPhone,
  validateSmsOptIn,
} from "./customer-sms";

function fields(values: Record<string, string>): Pick<FormData, "get"> {
  return {
    get(name: string) {
      return values[name] ?? null;
    },
  };
}

describe("customer SMS opt-in helpers", () => {
  it("reads checkbox and phone fields", () => {
    assert.equal(readSmsNotifyEnabled(fields({ smsNotifyEnabled: "yes" })), true);
    assert.equal(readSmsNotifyEnabled(fields({})), false);
    assert.equal(readSmsPhone(fields({ smsNotifyPhone: "503-555-0100" })), "503-555-0100");
  });

  it("normalizes and validates phone numbers when enabled", () => {
    assert.equal(normalizeSmsPhone("(503) 555-0100"), "5035550100");
    const valid = validateSmsOptIn({
      enabled: true,
      phoneRaw: "+1 503 555 0100",
    });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.phone, "+15035550100");

    const missing = validateSmsOptIn({ enabled: true, phoneRaw: "" });
    assert.equal(missing.ok, false);

    const disabled = validateSmsOptIn({ enabled: false, phoneRaw: "" });
    assert.equal(disabled.ok, true);
  });
});

describe("customer request form SMS UI", () => {
  it("places SMS opt-in after existing order and before submit", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-request-portal.tsx"),
      "utf8",
    );
    assert.match(source, /Have an existing order\?/);
    assert.match(source, /Text me when plants from my request are available/);
    assert.match(source, /Enable SMS notifications/);
    assert.match(source, /data-sms-opt-in/);
    assert.match(source, /data-sms-phone-panel/);
    assert.ok(
      source.indexOf("Have an existing order?") <
        source.indexOf("Text me when plants from my request are available"),
    );
    assert.ok(
      source.indexOf("Text me when plants from my request are available") <
        source.indexOf("Submit request"),
    );
    assert.match(source, /Reply STOP to unsubscribe/);
    assert.match(source, /upt-sms-consent/);
    assert.doesNotMatch(source, /upt-sms-consent[\s\S]*<strong>/);
  });
});
