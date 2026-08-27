import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { FUTURE_CAMERA_PERMISSION, PHOTO_LIBRARY_PERMISSION } from "./permissions";

const root = path.join(import.meta.dirname, "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
}

describe("first Apple build config", () => {
  it("keeps Expo/EAS identity and sets the storefront display name", () => {
    const app = readJson("app.json") as {
      expo: {
        name: string;
        slug: string;
        scheme: string;
        version: string;
        owner: string;
        icon: string;
        splash: { backgroundColor: string };
        extra: { eas: { projectId: string } };
        ios: { bundleIdentifier: string; icon: string; splash: { backgroundColor: string } };
        plugins: unknown[];
      };
    };
    const eas = readJson("eas.json") as {
      cli: { appVersionSource: string };
      build: { development: object; preview: object; production: { autoIncrement: boolean } };
    };

    assert.equal(app.expo.name, "Request Portal");
    assert.equal(app.expo.slug, "upt-admin-ios");
    assert.equal(app.expo.scheme, "uptadmin");
    assert.equal(app.expo.version, "1.0.0");
    assert.equal(app.expo.owner, "unsolicited-plant-talks");
    assert.equal(app.expo.extra.eas.projectId, "2c4abfc0-98d5-462b-abd0-8ecba3deeeed");
    assert.equal(app.expo.ios.bundleIdentifier, "com.unsolicitedplanttalks.admin");
    assert.equal(app.expo.icon, "./assets/icon.png");
    assert.equal(app.expo.ios.icon, "./assets/icon.png");
    assert.equal(app.expo.splash.backgroundColor, "#002910");
    assert.equal(app.expo.ios.splash.backgroundColor, "#002910");
    assert.equal(eas.cli.appVersionSource, "remote");
    assert.equal(eas.build.production.autoIncrement, true);
    assert.ok(eas.build.development);
    assert.ok(eas.build.preview);
  });

  it("configures photo-library text and does not request camera", () => {
    const app = readJson("app.json");
    const expo = app.expo as { plugins: unknown[] };
    const picker = expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
    ) as [string, { photosPermission: string; cameraPermission: boolean; microphonePermission: boolean }];
    assert.equal(picker[1].photosPermission, PHOTO_LIBRARY_PERMISSION);
    assert.equal(picker[1].photosPermission, "Allow access to your photo library so you can upload photos to requests.");
    assert.equal(picker[1].cameraPermission, false);
    assert.equal(picker[1].microphonePermission, false);
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
