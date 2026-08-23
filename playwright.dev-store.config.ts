import { defineConfig } from "@playwright/test";

import { APPROVED_SMOKE_SHOP, FORBIDDEN_PRODUCTION_SHOPS } from "./app/lib/pr-risk";

const shop = process.env.SMOKE_SHOP || APPROVED_SMOKE_SHOP;
if ((FORBIDDEN_PRODUCTION_SHOPS as readonly string[]).includes(shop)) {
  throw new Error("Dev-store Playwright refused: this is a production shop.");
}
if (shop !== APPROVED_SMOKE_SHOP) {
  throw new Error(
    `Dev-store Playwright refused: SMOKE_SHOP must be exactly ${APPROVED_SMOKE_SHOP}.`,
  );
}

export default defineConfig({
  testDir: "./e2e/dev-store",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.APP_BASE_URL || "https://upt-plant-request-portal.onrender.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
