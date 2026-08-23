import { expect, test } from "@playwright/test";

import { smokeAdminToken } from "./helpers";

test.describe("Live admin smoke", () => {
  test("opens the EXACT PLANTS table through the smoke helper", async ({
    page,
  }) => {
    const token = smokeAdminToken();
    test.skip(!token, "ALLOW_SMOKE_ADMIN and SMOKE_TEST_SECRET are required");

    await page.context().addCookies([
      {
        name: "upt_smoke",
        value: token!,
        url: process.env.APP_BASE_URL || "https://upt-plant-request-portal.onrender.com",
      },
    ]);
    await page.goto("/app/exact-plants");
    await expect(page.getByText("EXACT PLANTS")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SHOPIFY_API_SECRET");
  });
});
