import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  mergeSettingsForm,
  scrollOffsetAfterSettingsSave,
  settingsFeedbackLabel,
  settingsFormFromShop,
  settingsFormHiddenForSave,
} from "./settings-form";
import type { ShopSettings } from "./types";

function shop(overrides: Partial<ShopSettings> = {}): ShopSettings {
  return {
    fedexRemovalWarning: "FedEx warning",
    adminNotificationEmail: "owner@example.com",
    adminEmailNewRequest: true,
    adminEmailCustomerResponse: true,
    adminEmailPaymentAfterVoid: false,
    adminPushNewRequest: true,
    adminPushItemStatusUpdate: false,
    registeredPushDevices: 1,
    fedexProductHandle: "upgrade-to-fedex",
    fedexProductSku: "FEDEX-15",
    ...overrides,
  };
}

describe("Settings form save does not jump", () => {
  it("merges server settings into the open form", () => {
    const current = settingsFormFromShop(shop());
    const next = settingsFormFromShop(
      shop({ adminEmailNewRequest: false, fedexRemovalWarning: "Updated" }),
    );
    assert.deepEqual(mergeSettingsForm(current, next).warning, "Updated");
    assert.equal(mergeSettingsForm(current, next).newRequestEmail, false);
    assert.equal(mergeSettingsForm(current, next).pushItemStatus, false);
  });

  it("keeps Saving / Saved / error in one reserved label", () => {
    assert.equal(
      settingsFeedbackLabel({ saving: true, saved: "Settings saved.", error: null }),
      "Saving…",
    );
    assert.equal(
      settingsFeedbackLabel({ saving: false, saved: "Settings saved.", error: null }),
      "Settings saved.",
    );
    assert.equal(
      settingsFeedbackLabel({ saving: false, saved: null, error: "Nope" }),
      "Nope",
    );
    assert.equal(settingsFeedbackLabel({ saving: false, saved: null, error: null }), " ");
    assert.equal(
      settingsFeedbackLabel({ saving: false, saved: null, error: null, hydrated: false }),
      " ",
    );
  });

  it("never hides the form for a save, and keeps the scroll offset", () => {
    assert.equal(settingsFormHiddenForSave(true), false);
    assert.equal(scrollOffsetAfterSettingsSave(420), 420);
    assert.equal(scrollOffsetAfterSettingsSave(0), 0);
  });

  it("keeps Settings scrolled down through a save: form stays mounted", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "SettingsScreen.tsx"),
      "utf8",
    );
    const app = readFileSync(path.join(import.meta.dirname, "..", "App.tsx"), "utf8");
    assert.match(source, /<ScrollView/);
    assert.doesNotMatch(source, /<ScrollView[^>]*\bkey=/);
    assert.doesNotMatch(source, /key=\{(saved|form|hydrated|saving)/);
    assert.match(source, /key=\{label\}/);
    assert.doesNotMatch(source, /if \(.*loading.*\) return/);
    assert.doesNotMatch(source, /setLoading\(true\)/);
    assert.match(source, /setSaving\(true\)/);
    assert.match(source, /styles\.feedback/);
    assert.match(source, /minHeight: 20/);
    assert.match(source, /mergeSettingsForm/);
    assert.match(source, /settingsFeedbackLabel/);
    assert.doesNotMatch(app, /key=\{.*Settings/);
    assert.match(app, /component=\{SettingsScreen\}/);
  });
});
