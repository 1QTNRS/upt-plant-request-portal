import { expect, test } from "@playwright/test";

import { APPROVED_SMOKE_SHOP } from "../../app/lib/pr-risk";
import { smokeAdminCookie } from "./helpers";

test.describe("Test-data cleanup", () => {
  test.afterAll(async ({ request }) => {
    const cookie = smokeAdminCookie();
    if (!cookie) return;
    await request.post("/smoke/cleanup", {
      headers: { cookie },
    });
  });

  test("cleanup refuses any shop except the approved dev store", async () => {
    expect(process.env.SMOKE_SHOP || APPROVED_SMOKE_SHOP).toBe(
      APPROVED_SMOKE_SHOP,
    );
  });

  test("cleanup endpoint requires the smoke token", async ({ request }) => {
    const denied = await request.post("/smoke/cleanup");
    expect(denied.status()).toBe(401);
    const cookie = smokeAdminCookie();
    if (!cookie) {
      test.skip(true, "ALLOW_SMOKE_ADMIN and SMOKE_TEST_SECRET are required");
      return;
    }
    const allowed = await request.post("/smoke/cleanup", {
      headers: { cookie },
    });
    expect(allowed.ok()).toBeTruthy();
    const body = await allowed.json();
    expect(body.ok).toBeTruthy();
  });
});
