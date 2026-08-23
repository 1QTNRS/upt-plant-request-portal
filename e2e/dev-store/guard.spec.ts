import { expect, test } from "@playwright/test";

import { APPROVED_SMOKE_SHOP } from "../../app/lib/pr-risk";

test("refuses to run unless the approved dev shop is configured", () => {
  expect(process.env.SMOKE_SHOP || APPROVED_SMOKE_SHOP).toBe(APPROVED_SMOKE_SHOP);
  expect(APPROVED_SMOKE_SHOP).toBe("upt-plant-request-dev.myshopify.com");
});

test("live /versionz is healthy and does not leak secrets", async ({ request }) => {
  const response = await request.get("/versionz");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.migrations).toBe("applied");
  expect(JSON.stringify(body)).not.toMatch(/SHOPIFY|RESEND|DATABASE|secret/i);
});
