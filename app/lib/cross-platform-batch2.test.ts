import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { formatAdminNoteTimestamp } from "./customer-time";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

describe("cross-platform batch 2 wiring", () => {
  it("removes Add Photo URL from web and iOS item editors", () => {
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const ios = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.doesNotMatch(web, /add-photo-url/);
    assert.doesNotMatch(web, /Add photo URL/i);
    assert.doesNotMatch(ios, /add-photo-url/);
    assert.doesNotMatch(ios, /Add photo URL/i);
    assert.doesNotMatch(ios, /paste a photo URL/i);
  });

  it("still renders historical URL photos on web admin thumbs", () => {
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(web, /item\.photoUrls\.map/);
    assert.match(web, /AdminPhotoThumbs/);
  });

  it("requires explicit Offered Name on web Exact Plant editor", () => {
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    assert.match(web, /Offered Name/);
    assert.match(web, /!growersChoice/);
  });

  it("exposes Heat Pack settings on web and iOS", () => {
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.settings.tsx"),
      "utf8",
    );
    const ios = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "screens", "SettingsScreen.tsx"),
      "utf8",
    );
    assert.match(web, /save-heat-pack-addon/);
    assert.match(web, /heatPackAddonEnabled/);
    assert.match(ios, /save-heat-pack-addon/);
    assert.match(ios, /Heat Pack Add-On/);
  });

  it("shows Heat Pack choice on the customer offer page when enabled", () => {
    const offer = readFileSync(
      path.join(REPO_ROOT, "app", "components", "customer-offer-view.tsx"),
      "utf8",
    );
    assert.match(offer, /heatPackAddonEnabled/);
    assert.match(offer, /heatPackChoice/);
    assert.match(offer, /data-heat-pack-section/);
  });

  it("formats internal note timestamps for admin views", () => {
    const stamp = formatAdminNoteTimestamp("2026-09-08T15:24:00.000Z", "UTC");
    assert.match(stamp, /Sep 8, 2026 · 3:24 PM/);
    const web = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const ios = readFileSync(
      path.join(REPO_ROOT, "mobile", "ios-admin", "src", "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(web, /AdminNoteTime/);
    assert.match(ios, /formatAdminNoteTimestamp/);
  });
});
