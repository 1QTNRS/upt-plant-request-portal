import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import expoConfig from "../app.config.js";
import {
  APP_IDENTITIES,
  DEVELOPMENT_IDENTITY,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  PRODUCTION_IDENTITY,
  resolveAppVariant,
} from "../appIdentity.js";
import { FUTURE_CAMERA_PERMISSION, PHOTO_LIBRARY_PERMISSION } from "./permissions";

const root = path.join(import.meta.dirname, "..");
const resolvePublicExpoConfig = expoConfig.resolvePublicExpoConfig;

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
}

function assertExactIdentity(
  app: ReturnType<typeof resolvePublicExpoConfig>,
  expected: typeof PRODUCTION_IDENTITY,
  label: string,
) {
  assert.equal(app.name, expected.name, `${label} name`);
  assert.equal(app.scheme, expected.scheme, `${label} scheme`);
  assert.equal(app.ios?.bundleIdentifier, expected.bundleIdentifier, `${label} bundleIdentifier`);
  assert.equal(app.android?.package, expected.androidPackage, `${label} android package`);
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
});

describe("resolved Expo config must not cross-contaminate identities", () => {
  it("DEVELOPMENT resolves exactly Request Portal Dev / .admin.dev / uptadmin-dev", () => {
    assertExactIdentity(
      resolvePublicExpoConfig("development"),
      DEVELOPMENT_IDENTITY,
      "development",
    );
  });

  it("PRODUCTION resolves exactly Request Portal / .admin / uptadmin", () => {
    assertExactIdentity(
      resolvePublicExpoConfig("production"),
      PRODUCTION_IDENTITY,
      "production",
    );
  });

  it("fails regression if production resolves to the .dev bundle ID", () => {
    const app = resolvePublicExpoConfig("production");
    assert.notEqual(
      app.ios?.bundleIdentifier,
      DEVELOPMENT_IDENTITY.bundleIdentifier,
      "production must never use the development bundle ID",
    );
    assert.notEqual(app.scheme, DEVELOPMENT_IDENTITY.scheme);
    assert.notEqual(app.name, DEVELOPMENT_IDENTITY.name);
  });

  it("fails regression if development resolves to the production bundle ID", () => {
    const app = resolvePublicExpoConfig("development");
    assert.notEqual(
      app.ios?.bundleIdentifier,
      PRODUCTION_IDENTITY.bundleIdentifier,
      "development must never use the production bundle ID",
    );
    assert.notEqual(app.scheme, PRODUCTION_IDENTITY.scheme);
    assert.notEqual(app.name, PRODUCTION_IDENTITY.name);
  });

  it("keeps app.json production defaults aligned with the shipped App Store identity", () => {
    const base = readJson("app.json").expo as {
      name: string;
      scheme: string;
      ios: { bundleIdentifier: string };
    };
    assert.equal(base.name, PRODUCTION_IDENTITY.name);
    assert.equal(base.scheme, PRODUCTION_IDENTITY.scheme);
    assert.equal(base.ios.bundleIdentifier, PRODUCTION_IDENTITY.bundleIdentifier);
    assert.deepEqual(APP_IDENTITIES.production, PRODUCTION_IDENTITY);
    assert.deepEqual(APP_IDENTITIES.development, DEVELOPMENT_IDENTITY);
  });
});

describe("first Apple build config", () => {
  it("keeps Expo/EAS identity and sets the storefront display name", () => {
    const app = resolvePublicExpoConfig("production");
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
    assert.equal(app.version, "1.0.1");
    assert.equal(app.owner, EXPO_OWNER);
    assert.equal(
      (app.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId,
      EAS_PROJECT_ID,
    );
    assert.equal(app.ios?.bundleIdentifier, "com.unsolicitedplanttalks.admin");
    assert.equal(app.ios?.supportsTablet, false);
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
    const app = resolvePublicExpoConfig("production");
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
