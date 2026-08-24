import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { THEME, themeBadgeStyle } from "./theme";

describe("brand theme", () => {
  it("keeps the mock palette", () => {
    assert.equal(THEME.darkGreen, "#002910");
    assert.equal(THEME.yellow, "#f1a638");
    assert.equal(THEME.mint, "#d6ece2");
  });

  it("paints the customer page mint and nested boxes mint without touching admin", () => {
    const themeSource = readFileSync(
      path.join(import.meta.dirname, "..", "components", "theme.tsx"),
      "utf8",
    );
    const layout = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "customer.tsx"),
      "utf8",
    );
    const admin = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.tsx"),
      "utf8",
    );
    assert.match(themeSource, /\.upt-customer-surface \{[\s\S]*THEME\.mint/);
    assert.match(themeSource, /\.upt-nested-box \{[\s\S]*THEME\.mint/);
    assert.match(themeSource, /\.upt-card \{[\s\S]*THEME\.white/);
    assert.match(themeSource, /paintDocument/);
    assert.match(layout, /paintDocument=\{!data\.viaAppProxy\}/);
    assert.match(layout, /inShopTheme=\{data\.viaAppProxy\}/);
    assert.ok(
      !admin.includes("CustomerSurface"),
      "admin chrome must not sit on the customer mint page",
    );
  });

  it("paints New mint, payable yellow, and Closed dark green", () => {
    assert.equal(themeBadgeStyle("info", "New").background, THEME.mint);
    assert.equal(
      themeBadgeStyle("warning", "Needs Payment").background,
      THEME.yellow,
    );
    assert.equal(themeBadgeStyle("success", "Closed").background, THEME.darkGreen);
    assert.equal(themeBadgeStyle("success", "Closed").color, THEME.white);
  });
});

describe("local time is shown to both sides", () => {
  it("rewrites every remaining admin stamp after hydrate", () => {
    const dashboard = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app._index.tsx"),
      "utf8",
    );
    const requestPage = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.requests.$id.tsx"),
      "utf8",
    );
    const analytics = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.analytics.tsx"),
      "utf8",
    );
    const table = readFileSync(
      path.join(import.meta.dirname, "..", "components", "exact-plants-table.tsx"),
      "utf8",
    );
    assert.match(dashboard, /ViewerLocalTime/);
    assert.match(dashboard, /submittedAtIso/);
    assert.match(requestPage, /sentOffer\.sentAtIso/);
    assert.match(requestPage, /sentOffer\.expiresAtIso/);
    assert.match(requestPage, /respondedAtIso/);
    assert.match(analytics, /lastRequestAtIso/);
    assert.match(table, /ViewerLocalTime/);
  });

  it("rewrites customer stamps from the browser zone", () => {
    const portal = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-request-portal.tsx"),
      "utf8",
    );
    const offer = readFileSync(
      path.join(import.meta.dirname, "..", "components", "customer-offer-view.tsx"),
      "utf8",
    );
    const detail = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "customer.requests.$id.tsx"),
      "utf8",
    );
    assert.match(portal, /CustomerTime/);
    assert.match(offer, /CustomerTime/);
    assert.match(detail, /data-customer-time/);
  });
});
