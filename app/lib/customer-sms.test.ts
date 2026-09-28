import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CUSTOMER_SMS_OPTIN_SCRIPT } from "../components/customer-enhance";
import {
  canonicalUsCaSmsPhoneE164,
  capUsCaNationalDigits,
  CUSTOMER_SMS_OPT_IN_ENABLED,
  formatSmsPhoneFieldDisplay,
  formatUsCaNationalDigitsForDisplay,
  normalizeSmsPhone,
  parseUsCaSmsPhoneNationalDigits,
  readSmsNotifyEnabled,
  readSmsPhone,
  SMS_PHONE_INVALID_MESSAGE,
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
    assert.equal(readSmsPhone(fields({ smsNotifyPhone: "(503) 555-0100" })), "(503) 555-0100");
  });

  it("accepts 10 raw digits and stores canonical E.164", () => {
    const valid = validateSmsOptIn({ enabled: true, phoneRaw: "9095551234" });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.phone, "+19095551234");
  });

  it("accepts formatted 10-digit numbers", () => {
    const valid = validateSmsOptIn({
      enabled: true,
      phoneRaw: "(909) 555-1234",
    });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.phone, "+19095551234");
  });

  it("accepts +1 numbers and stores canonical E.164", () => {
    const valid = validateSmsOptIn({
      enabled: true,
      phoneRaw: "+1 909 555 1234",
    });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.phone, "+19095551234");
    assert.equal(normalizeSmsPhone("+1 503 555 0100"), "+15035550100");
  });

  it("rejects 9 digits, 11 national digits, excess digits, and letters", () => {
    for (const phoneRaw of [
      "909555123",
      "90955512345",
      "909555123456",
      "call-me-maybe",
      "(909) 555-123",
    ]) {
      const result = validateSmsOptIn({ enabled: true, phoneRaw });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.message, SMS_PHONE_INVALID_MESSAGE);
    }

    const elevenNational = validateSmsOptIn({
      enabled: true,
      phoneRaw: "290955512345",
    });
    assert.equal(elevenNational.ok, false);

    assert.equal(parseUsCaSmsPhoneNationalDigits("909555123"), null);
    assert.equal(parseUsCaSmsPhoneNationalDigits("290955512345"), null);
    assert.equal(parseUsCaSmsPhoneNationalDigits("abc"), null);
  });

  it("requires a number when SMS is enabled", () => {
    const missing = validateSmsOptIn({ enabled: true, phoneRaw: "" });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.message, "Enter a mobile number to enable SMS notifications.");
    }

    const disabled = validateSmsOptIn({ enabled: false, phoneRaw: "" });
    assert.equal(disabled.ok, true);
  });

  it("formats Shopify +1 prefill for display", () => {
    assert.equal(formatSmsPhoneFieldDisplay("+19095551234"), "(909) 555-1234");
    assert.equal(formatSmsPhoneFieldDisplay("9095551234"), "(909) 555-1234");
    assert.equal(formatSmsPhoneFieldDisplay("+1 909 555 1234"), "(909) 555-1234");
  });

  it("caps national digits at 10 and formats progressively", () => {
    assert.equal(capUsCaNationalDigits("909555123456789"), "9095551234");
    assert.equal(capUsCaNationalDigits("19095551234"), "9095551234");
    assert.equal(formatSmsPhoneFieldDisplay("909555123456789"), "(909) 555-1234");

    assert.equal(
      formatUsCaNationalDigitsForDisplay("9095551234"),
      "(909) 555-1234",
    );
    assert.equal(formatUsCaNationalDigitsForDisplay("909555123"), "(909) 555-123");
    assert.equal(formatUsCaNationalDigitsForDisplay("909"), "(909");
  });

  it("canonical E.164 uses +1 and 10 national digits", () => {
    assert.equal(canonicalUsCaSmsPhoneE164("9095551234"), "+19095551234");
  });
});

describe("customer request form SMS UI", () => {
  it("hides the SMS opt-in card while CUSTOMER_SMS_OPT_IN_ENABLED is false", () => {
    assert.equal(CUSTOMER_SMS_OPT_IN_ENABLED, false);
    const portal = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-request-portal.tsx"),
      "utf8",
    );
    assert.match(portal, /CUSTOMER_SMS_OPT_IN_ENABLED \? \(/);
    assert.match(portal, /data-sms-opt-in/);
    assert.match(portal, /className="upt-sms-consent"/);
    assert.match(portal, /Text me when plants from my request are available/);
  });

  it("skips SMS preference writes on submit while the UI flag is off", () => {
    const submit = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "customer.submit.tsx"),
      "utf8",
    );
    const demo = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.customer-request-form.tsx"),
      "utf8",
    );
    assert.match(submit, /if \(CUSTOMER_SMS_OPT_IN_ENABLED\)/);
    assert.match(submit, /saveCustomerSmsNotifyPreference/);
    assert.match(demo, /CUSTOMER_SMS_OPT_IN_ENABLED && smsValidation\.ok/);
  });

  it("keeps existing order and submit adjacent without a visible SMS card", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-request-portal.tsx"),
      "utf8",
    );
    assert.match(source, /Have an existing order\?/);
    assert.match(source, /Submit request/);
    assert.ok(
      source.indexOf("Have an existing order?") < source.indexOf("Submit request"),
    );
  });
});

describe("customer SMS phone enhance script", () => {
  it("formats and caps the phone field on input", () => {
    assert.match(CUSTOMER_SMS_OPTIN_SCRIPT, /data-sms-phone/);
    assert.match(CUSTOMER_SMS_OPTIN_SCRIPT, /capNational/);
    assert.match(CUSTOMER_SMS_OPTIN_SCRIPT, /addEventListener\(\s*"input"/);
    assert.match(CUSTOMER_SMS_OPTIN_SCRIPT, /slice\(0, 10\)/);
    assert.match(CUSTOMER_SMS_OPTIN_SCRIPT, /slice\(0, 11\)/);
  });
});
