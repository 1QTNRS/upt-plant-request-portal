import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_LIGHTBOX_SCRIPT,
  CUSTOMER_TIME_SCRIPT,
  FEDEX_WARNING_SCRIPT,
} from "../components/customer-enhance";

describe("customer progressive-enhancement scripts", () => {
  it("reads the browser IANA zone and never guesses from an IP", () => {
    assert.match(CUSTOMER_TIME_SCRIPT, /resolvedOptions\(\)\.timeZone/);
    assert.doesNotMatch(CUSTOMER_TIME_SCRIPT, /geo|ip address|ipinfo/i);
    assert.match(CUSTOMER_TIME_SCRIPT, /data-customer-time/);
    assert.match(CUSTOMER_TIME_SCRIPT, /save-timezone/);
  });

  it("opens a customer photo lightbox with swipe and previous/next", () => {
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-customer-photo/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /data-lightbox-prev/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /pointerup/);
    assert.match(CUSTOMER_LIGHTBOX_SCRIPT, /ArrowRight/);
  });

  it("opens the FedEx warning only when an accepted plant would lose the upgrade", () => {
    assert.match(FEDEX_WARNING_SCRIPT, /acceptedCount/);
    assert.match(FEDEX_WARNING_SCRIPT, /box\.disabled = !enabled/);
    assert.match(FEDEX_WARNING_SCRIPT, /fedex-keep/);
    assert.match(FEDEX_WARNING_SCRIPT, /fedex-confirm-remove/);
    assert.match(FEDEX_WARNING_SCRIPT, /fedex-ack/);
    assert.match(FEDEX_WARNING_SCRIPT, /Escape/);
  });
});
