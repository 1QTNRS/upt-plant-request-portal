import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CUSTOMER_TIME_FALLBACK_ZONE,
  customerTimeZoneLabel,
  formatCustomerDateTime,
  formatViewerDateTime,
  normalizeIanaTimeZone,
} from "./customer-time";

describe("normalizeIanaTimeZone", () => {
  it("accepts a real IANA zone and rejects junk", () => {
    assert.equal(normalizeIanaTimeZone("America/Los_Angeles"), "America/Los_Angeles");
    assert.equal(normalizeIanaTimeZone("America/New_York"), "America/New_York");
    assert.equal(normalizeIanaTimeZone("UTC"), "UTC");
    assert.equal(normalizeIanaTimeZone("Not/AZone"), null);
    assert.equal(normalizeIanaTimeZone(""), null);
    assert.equal(normalizeIanaTimeZone("  "), null);
    assert.equal(normalizeIanaTimeZone(null), null);
  });
});

describe("formatCustomerDateTime", () => {
  // January is standard time; July is daylight time. 18:00 UTC is 10:00
  // Pacific and 13:00 Eastern in January, 11:00 / 14:00 in July.
  const utcWinter = new Date("2026-01-15T18:00:00.000Z");
  const utcSummer = new Date("2026-07-08T18:00:00.000Z");

  it("keeps the stored instant in UTC — formatting never rewrites the Date", () => {
    const before = utcWinter.toISOString();
    formatCustomerDateTime(utcWinter, "America/Los_Angeles");
    assert.equal(utcWinter.toISOString(), before);
    assert.equal(before, "2026-01-15T18:00:00.000Z");
  });

  it("formats a known zone with that zone's abbreviation", () => {
    const pacific = formatCustomerDateTime(utcWinter, "America/Los_Angeles");
    const eastern = formatCustomerDateTime(utcWinter, "America/New_York");
    assert.match(pacific, /10:00 AM/);
    assert.match(pacific, /PST/);
    assert.match(eastern, /1:00 PM/);
    assert.match(eastern, /EST/);
    assert.notEqual(pacific, eastern);
  });

  it("handles daylight saving time", () => {
    const pacificWinter = formatCustomerDateTime(utcWinter, "America/Los_Angeles");
    const pacificSummer = formatCustomerDateTime(utcSummer, "America/Los_Angeles");
    assert.match(pacificWinter, /PST/);
    assert.match(pacificSummer, /PDT/);
    assert.match(pacificWinter, /10:00 AM/);
    assert.match(pacificSummer, /11:00 AM/);
  });

  it("labels the fallback timezone instead of inventing a local clock", () => {
    const fallback = formatCustomerDateTime(utcWinter, null);
    assert.match(fallback, /6:00 PM/);
    assert.match(fallback, /UTC/);
    assert.equal(customerTimeZoneLabel(undefined), CUSTOMER_TIME_FALLBACK_ZONE);
    assert.equal(formatCustomerDateTime(utcWinter, "bogus"), fallback);
  });

  it("never lets one customer's zone rewrite another customer's stamp", () => {
    const alex = formatCustomerDateTime(utcWinter, "America/Los_Angeles");
    const jordan = formatCustomerDateTime(utcWinter, "America/New_York");
    assert.match(alex, /PST/);
    assert.match(jordan, /EST/);
    assert.notEqual(alex, jordan);
  });
});

describe("formatViewerDateTime", () => {
  // 19:00 UTC on 24 Aug 2026 is 3:00 PM Eastern and 12:00 PM Pacific.
  const writtenInEastern = "2026-08-24T19:00:00.000Z";

  it("shows the same instant in the reader's zone, not the writer's", () => {
    const eastern = formatViewerDateTime(writtenInEastern, "America/New_York");
    const pacific = formatViewerDateTime(writtenInEastern, "America/Los_Angeles");
    assert.match(eastern, /3:00 PM/);
    assert.match(eastern, /EDT/);
    assert.match(pacific, /12:00 PM/);
    assert.match(pacific, /PDT/);
    assert.notEqual(eastern, pacific);
  });

  it("rewrites admin note stamps in the browser after hydrate", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "components", "viewer-local-time.tsx"),
      "utf8",
    );
    assert.match(source, /formatViewerDateTime\(iso\)/);
    assert.match(source, /useState\(fallback\)/);
  });
});
