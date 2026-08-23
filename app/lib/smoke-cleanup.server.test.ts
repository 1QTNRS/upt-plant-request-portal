import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSmokeAutomationEmail,
  cleanupSmokePortalData,
} from "./smoke-cleanup.server";

describe("smoke cleanup guard", () => {
  it("only treats the reserved smoke mailbox as automation data", () => {
    assert.equal(isSmokeAutomationEmail("smoke+run1@upt-smoke.test"), true);
    assert.equal(isSmokeAutomationEmail("alex.rivera@example.com"), false);
    assert.equal(isSmokeAutomationEmail("someone@upt-smoke.test"), false);
  });

  it("refuses to run against any shop except the approved dev store", async () => {
    await assert.rejects(
      () => cleanupSmokePortalData("demo-shop.myshopify.com"),
      /must be exactly/,
    );
    await assert.rejects(
      () => cleanupSmokePortalData("unsolicited-plant-talks.myshopify.com"),
      /production shop/,
    );
  });
});
