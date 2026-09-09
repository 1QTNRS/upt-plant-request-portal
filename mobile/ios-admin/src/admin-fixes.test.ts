import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  formatPortalDateTime,
  PORTAL_DISPLAY_TIME_ZONE,
} from "./admin-time";
import {
  applyAdminActionResult,
  resetRequestDetailTransientState,
} from "./request-detail-ui";
import type { ActionResult, RequestDetail } from "./types";

describe("admin offer expiration display", () => {
  const winter = "2026-01-15T18:00:00.000Z";
  const summer = "2026-07-08T18:00:00.000Z";

  it("formats expiration in America/Los_Angeles with PST/PDT", () => {
    assert.equal(PORTAL_DISPLAY_TIME_ZONE, "America/Los_Angeles");
    assert.match(formatPortalDateTime(winter), /10:00 AM PST/);
    assert.match(formatPortalDateTime(summer), /11:00 AM PDT/);
    assert.equal(new Date(winter).toISOString(), winter);
  });

  it("uses the shared formatter on iOS request detail", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(source, /formatPortalDateTime\(detail\.sentOffer\.expiresAtIso\)/);
    assert.doesNotMatch(source, /<Text style=\{ui\.muted\}>\{detail\.sentOffer\.expiresAt\}<\/Text>/);
  });

  it("formats admin sentOffer.expiresAt in Pacific Time on the server", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "..", "..", "app", "lib", "portal.server.ts"),
      "utf8",
    );
    assert.match(source, /expiresAt: formatCustomerDateTime\(offer\.expiresAt\)/);
    assert.doesNotMatch(source, /expiresAt: formatDateTime\(offer\.expiresAt\)/);
  });
});

describe("admin override close UI reset", () => {
  it("clears confirmation after a successful close", () => {
    let confirm = true;
    let error: string | null = "Confirm Close Entire Request to proceed.";
    let dismissed = false;
    const request = { id: "req-1" } as RequestDetail;
    const ok = applyAdminActionResult({
      result: { ok: true, request },
      setError: (value) => {
        error = value;
      },
      setConfirmOverride: (value) => {
        confirm = value;
      },
      onSuccess: () => {
        dismissed = true;
      },
    });
    assert.equal(ok, true);
    assert.equal(confirm, false);
    assert.equal(error, null);
    assert.equal(dismissed, true);
  });

  it("keeps confirmation visible until the server accepts the override", () => {
    let confirm = false;
    applyAdminActionResult({
      result: {
        ok: false,
        error: "Confirm Close Entire Request to proceed.",
        pendingAdminOverrideClose: true,
      },
      setError: () => {},
      setConfirmOverride: (value) => {
        confirm = value;
      },
    });
    assert.equal(confirm, true);
  });

  it("resets transient detail state when leaving a request", () => {
    let confirm = true;
    let error: string | null = "stale";
    resetRequestDetailTransientState({
      setConfirmOverride: (value) => {
        confirm = value;
      },
      setError: (value) => {
        error = value;
      },
    });
    assert.equal(confirm, false);
    assert.equal(error, null);
  });

  it("dismisses keyboard and stock overlays after success in the detail screen", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(source, /applyAdminActionResult/);
    assert.match(source, /dismissInteractionBlockers/);
    assert.match(source, /useFocusEffect/);
    assert.match(source, /KeyboardAvoidingView[\s\S]*key=\{requestId\}/);
  });
});

describe("customer final approval summary ordering", () => {
  it("renders accepted before declined inside the final summary", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "..", "..", "app", "components", "customer-offer-view.tsx"),
      "utf8",
    );
    assert.match(source, /Final approval summary[\s\S]*>ACCEPTED</);
    assert.match(source, />DECLINED</);
    assert.ok(source.indexOf(">ACCEPTED<") < source.indexOf(">DECLINED<"));
  });
});
