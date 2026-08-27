import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

const SECRET_PATTERNS = [
  /SHOPIFY_API_SECRET/,
  /shpat_[0-9a-f]{20,}/i,
  /shpss_[0-9a-z]{20,}/i,
  /RESEND_API_KEY/,
  /re_[A-Za-z0-9]{20,}/,
  /DATABASE_URL\s*=/,
  /postgres(?:ql)?:\/\//i,
  /CRON_SECRET/,
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".expo") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|json)$/.test(entry.name) && entry.name !== "package-lock.json") {
      out.push(full);
    }
  }
  return out;
}

describe("mobile privacy audit", () => {
  it("does not bundle server secrets or log the device token", () => {
    const files = collectSourceFiles(root);
    assert.ok(files.some((file) => file.endsWith("App.tsx")));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of SECRET_PATTERNS) {
        assert.equal(pattern.test(text), false, `${path.relative(root, file)} matched ${pattern}`);
      }
    }

    const app = readFileSync(path.join(root, "App.tsx"), "utf8");
    const api = readFileSync(path.join(root, "src/api.ts"), "utf8");
    const register = readFileSync(path.join(root, "src/register-push.ts"), "utf8");
    const settings = readFileSync(path.join(root, "src/screens/SettingsScreen.tsx"), "utf8");
    assert.match(app, /SecureStore\.(get|set|delete)ItemAsync\(TOKEN_KEY/);
    assert.match(app, /https:\/\/upt-plant-request-portal\.onrender\.com/);
    assert.doesNotMatch(app, /console\.(log|debug|info|warn)\(/);
    assert.doesNotMatch(api, /console\.(log|debug|info|warn)\(/);
    assert.doesNotMatch(register, /console\.(log|debug|info|warn)\(/);
    assert.doesNotMatch(settings, /expoPushToken/);
    assert.doesNotMatch(app, /SHOPIFY_API_KEY=devkey/);
    assert.doesNotMatch(app, /demo-shop\.myshopify\.com/);
  });
});
