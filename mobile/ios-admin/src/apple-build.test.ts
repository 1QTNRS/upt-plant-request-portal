import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildExpoConfig } from "../app.config.js";
import {
  APP_IDENTITIES,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  iosAdminLinkPrefixForVariant,
  resolveAppVariant,
} from "../appIdentity.js";
import { FUTURE_CAMERA_PERMISSION, PHOTO_LIBRARY_PERMISSION } from "./permissions";

const root = path.join(import.meta.dirname, "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
}

describe("iOS app identity variants", () => {
  it("defaults to production when APP_VARIANT is unset", () => {
    assert.equal(resolveAppVariant(undefined), "production");
    assert.equal(resolveAppVariant(""), "production");
    assert.equal(resolveAppVariant("production"), "production");
  });

  it("selects development only when APP_VARIANT=development", () => {
    assert.equal(resolveAppVariant("development"), "development");
  });

  it("keeps production storefront identity unchanged", () => {
    const app = buildExpoConfig("production");
    const identity = APP_IDENTITIES.production;

    assert.equal(app.name, identity.name);
    assert.equal(app.scheme, identity.scheme);
    assert.equal(app.ios?.bundleIdentifier, identity.bundleIdentifier);
    assert.equal(app.android?.package, identity.androidPackage);
    assert.equal(iosAdminLinkPrefixForVariant("production"), "uptadmin://");
  });

  it("uses a separate development identity installable beside production", () => {
    const app = buildExpoConfig("development");
    const identity = APP_IDENTITIES.development;

    assert.equal(app.name, identity.name);
    assert.equal(app.scheme, identity.scheme);
    assert.equal(app.ios?.bundleIdentifier, identity.bundleIdentifier);
    assert.equal(app.android?.package, identity.androidPackage);
    assert.equal(iosAdminLinkPrefixForVariant("development"), "uptadmin-dev://");
    assert.notEqual(
      identity.bundleIdentifier,
      APP_IDENTITIES.production.bundleIdentifier,
    );
    assert.notEqual(identity.scheme, APP_IDENTITIES.production.scheme);
  });
});

describe("first Apple build config", () => {
  it("keeps Expo/EAS identity and sets the storefront display name", () => {
    const app = buildExpoConfig("production");
    const eas = readJson("eas.json") as {
      cli: { appVersionSource: string };
      build: {
        development: { env: { APP_VARIANT: string } };
        preview: { env: { APP_VARIANT: string } };
        production: { autoIncrement: boolean; env: { APP_VARIANT: string } };
      };
    };

    assert.equal(app.name, "Request Portal");
    assert.equal(app.slug, EXPO_SLUG);
    assert.equal(app.scheme, "uptadmin");
    assert.equal(app.version, "1.0.0");
    assert.equal(app.owner, EXPO_OWNER);
    assert.equal(app.extra?.eas?.projectId, EAS_PROJECT_ID);
    assert.equal(app.ios?.bundleIdentifier, "com.unsolicitedplanttalks.admin");
    assert.equal(app.icon, "./assets/icon.png");
    assert.equal(app.ios?.icon, "./assets/icon.png");
    assert.equal(app.splash?.backgroundColor, "#002910");
    assert.equal(app.splash?.image, "./assets/splash-icon.png");
    assert.equal(app.splash?.imageWidth, 260);
    assert.equal(app.splash?.resizeMode, "contain");
    assert.equal(app.ios?.splash?.backgroundColor, "#002910");
    assert.equal(app.ios?.splash?.image, "./assets/splash-icon.png");
    assert.equal(app.ios?.splash?.imageWidth, 260);
    assert.equal(app.ios?.splash?.resizeMode, "contain");
    const splashPlugin = app.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    ) as [string, { backgroundColor: string; image: string; imageWidth: number; resizeMode: string }];
    assert.equal(splashPlugin[1].backgroundColor, "#002910");
    assert.equal(splashPlugin[1].image, "./assets/splash-icon.png");
    assert.equal(splashPlugin[1].imageWidth, 260);
    assert.equal(splashPlugin[1].resizeMode, "contain");
    assert.equal(
      app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads,
      false,
    );
    assert.equal(eas.cli.appVersionSource, "remote");
    assert.equal(eas.build.production.autoIncrement, true);
    assert.equal(eas.build.development.env.APP_VARIANT, "development");
    assert.equal(eas.build.preview.env.APP_VARIANT, "production");
    assert.equal(eas.build.production.env.APP_VARIANT, "production");
  });

  it("configures photo-library text and does not request camera", () => {
    const app = buildExpoConfig("production");
    const picker = app.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
    ) as [string, { photosPermission: string; cameraPermission: boolean; microphonePermission: boolean }];
    const secureStore = app.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-secure-store",
    ) as [string, { faceIDPermission: boolean }];
    assert.equal(picker[1].photosPermission, PHOTO_LIBRARY_PERMISSION);
    assert.equal(
      picker[1].photosPermission,
      "Allow access to your photo library so you can upload photos to requests.",
    );
    assert.equal(picker[1].cameraPermission, false);
    assert.equal(picker[1].microphonePermission, false);
    assert.equal(secureStore[1].faceIDPermission, false);
    assert.equal(
      FUTURE_CAMERA_PERMISSION,
      "Allow camera access so you can take plant photos for requests.",
    );
    const serialized = JSON.stringify(app);
    assert.doesNotMatch(serialized, /NSCameraUsageDescription/);
    assert.doesNotMatch(serialized, /Allow camera access/);
  });

  it("expects a 1024 icon at the configured path when the file is present", () => {
    const iconPath = path.join(root, "assets/icon.png");
    if (existsSync(iconPath)) {
      const header = readFileSync(iconPath).subarray(0, 8);
      assert.deepEqual([...header], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
});
