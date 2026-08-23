import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /dev-store/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3010",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "SHOPIFY_API_KEY=devkey SHOPIFY_API_SECRET=devsecret SHOPIFY_APP_URL=http://127.0.0.1:3010 SCOPES=write_products PORT=3010 npx react-router dev --host 127.0.0.1 --port 3010",
    url: "http://127.0.0.1:3010/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
