import { expect, test } from "@playwright/test";

test.describe("Deploy identity", () => {
  test("healthz and versionz are public and do not leak secrets", async ({
    request,
  }) => {
    const health = await request.get("/healthz");
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toEqual({ status: "ok" });

    const version = await request.get("/versionz");
    expect(version.ok()).toBeTruthy();
    const body = await version.json();
    expect(body.status).toBe("ok");
    expect(body.migrations).toBe("applied");
    expect(Object.keys(body).sort()).toEqual(["commit", "migrations", "status"]);
    expect(JSON.stringify(body)).not.toMatch(
      /SHOPIFY|RESEND|DATABASE|secret|token|password/i,
    );
  });
});
