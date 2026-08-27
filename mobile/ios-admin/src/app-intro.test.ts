import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APP_INTRO_BACKGROUND,
  APP_INTRO_DURATION_MS,
  APP_INTRO_LOGO_WIDTH,
  APP_INTRO_SPLASH_IMAGE,
  APP_INTRO_START_OPACITY,
  APP_INTRO_START_SCALE,
  appIntroDurationMs,
  appIntroShowsLogoBeforeAnimation,
  shouldPlayAppIntro,
} from "./app-intro";

describe("in-app intro", () => {
  it("plays only for a fresh launch, not while restoring a session", () => {
    assert.equal(shouldPlayAppIntro({ sessionKind: "unknown" }), false);
    assert.equal(shouldPlayAppIntro({ sessionKind: "restore" }), false);
    assert.equal(shouldPlayAppIntro({ sessionKind: "fresh" }), true);
  });

  it("stays in the 0.8–1.5s window and skips motion when asked", () => {
    assert.equal(APP_INTRO_BACKGROUND, "#002910");
    assert.equal(APP_INTRO_LOGO_WIDTH, 260);
    assert.equal(APP_INTRO_SPLASH_IMAGE, "./assets/splash-icon.png");
    assert.ok(APP_INTRO_DURATION_MS >= 800);
    assert.ok(APP_INTRO_DURATION_MS <= 1500);
    assert.equal(appIntroDurationMs(false), APP_INTRO_DURATION_MS);
    assert.equal(appIntroDurationMs(true), 0);
  });

  it("shows the logo immediately and only scales, never fading from 0", () => {
    assert.equal(APP_INTRO_START_OPACITY, 1);
    assert.equal(APP_INTRO_START_SCALE, 0.96);
    assert.equal(appIntroShowsLogoBeforeAnimation(), true);
  });
});
