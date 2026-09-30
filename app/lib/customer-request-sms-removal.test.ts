import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

describe("abandoned customer SMS feature removal", () => {
  it("does not reference SMS modules or preference writers", () => {
    const paths = [
      "app/routes/customer.submit.tsx",
      "app/routes/app.customer-request-form.tsx",
      "app/lib/customer-portal.server.ts",
      "app/components/customer-request-portal.tsx",
    ];
    for (const relative of paths) {
      const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      assert.doesNotMatch(source, /customer-sms/);
      assert.doesNotMatch(source, /smsNotifyEnabled/);
      assert.doesNotMatch(source, /saveCustomerSmsNotifyPreference/);
    }
  });

  it("keeps Heat Pack settings on the admin settings page", () => {
    const settings = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "app.settings.tsx"),
      "utf8",
    );
    assert.match(settings, /Heat Pack Add-On enabled/);
    assert.match(settings, /heatPackAddonEnabled/);
    assert.doesNotMatch(settings, /SMS/i);
  });
});
