import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  customerTimeZoneLabel,
  formatAdminNoteTimestamp,
  formatCustomerDateTime,
  formatViewerDateTime,
  PORTAL_DISPLAY_TIME_ZONE,
} from "./customer-time";

describe("Pacific Time display", () => {
  const utcWinter = new Date("2026-01-15T18:00:00.000Z");
  const utcSummer = new Date("2026-07-08T18:00:00.000Z");

  it("keeps the stored instant in UTC — formatting never rewrites the Date", () => {
    const before = utcWinter.toISOString();
    formatCustomerDateTime(utcWinter);
    assert.equal(utcWinter.toISOString(), before);
    assert.equal(before, "2026-01-15T18:00:00.000Z");
  });

  it("formats every customer-facing stamp in America/Los_Angeles", () => {
    assert.equal(PORTAL_DISPLAY_TIME_ZONE, "America/Los_Angeles");
    const pacific = formatCustomerDateTime(utcWinter);
    assert.match(pacific, /10:00 AM/);
    assert.match(pacific, /PST/);
    assert.equal(
      formatCustomerDateTime(utcWinter, "America/New_York"),
      pacific,
      "passed zones are ignored for display",
    );
  });

  it("handles daylight saving time automatically", () => {
    const pacificWinter = formatCustomerDateTime(utcWinter);
    const pacificSummer = formatCustomerDateTime(utcSummer);
    assert.match(pacificWinter, /PST/);
    assert.match(pacificSummer, /PDT/);
    assert.match(pacificWinter, /10:00 AM/);
    assert.match(pacificSummer, /11:00 AM/);
  });

  it("labels Pacific Time consistently", () => {
    assert.equal(customerTimeZoneLabel(undefined), PORTAL_DISPLAY_TIME_ZONE);
  });
});

describe("formatViewerDateTime", () => {
  const instant = "2026-08-24T19:00:00.000Z";

  it("shows Pacific Time for admin and customer viewers", () => {
    const label = formatViewerDateTime(instant);
    assert.match(label, /12:00 PM/);
    assert.match(label, /PDT/);
    assert.equal(formatViewerDateTime(instant, "America/New_York"), label);
  });

  it("rewrites timestamps in the browser after hydrate", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "components", "viewer-local-time.tsx"),
      "utf8",
    );
    assert.match(source, /formatViewerDateTime\(iso\)/);
    assert.match(source, /useState\(fallback\)/);
  });
});

describe("formatAdminNoteTimestamp", () => {
  it("uses Sep 8, 2026 · 3:24 PM PT style in Pacific Time", () => {
    const stamp = formatAdminNoteTimestamp("2026-09-08T22:24:00.000Z");
    assert.match(stamp, /Sep 8, 2026 · 3:24 PM PDT/);
  });
});
