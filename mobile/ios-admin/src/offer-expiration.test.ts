import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatOfferExpirationUrgencyPill,
  requestShowsAnsweredPill,
} from "./offer-expiration";

describe("iOS offer expiration parity", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("matches shared urgency pill thresholds", () => {
    const inTwoDays = new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString();
    const inEightHours = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
    assert.equal(formatOfferExpirationUrgencyPill(inTwoDays, now), "<2 days");
    assert.equal(formatOfferExpirationUrgencyPill(inEightHours, now), "<12 hrs");
  });
});

describe("iOS Answered pill parity", () => {
  it("shows Answered only for Pending requests with a response", () => {
    assert.equal(requestShowsAnsweredPill("Pending", true), true);
    assert.equal(requestShowsAnsweredPill("Closed", true), false);
  });
});
