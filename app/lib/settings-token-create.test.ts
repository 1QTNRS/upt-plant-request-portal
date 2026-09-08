import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ActionFunction, ActionFunctionArgs } from "react-router";

import {
  isEmbeddedAdminPath,
  isShopifyAdminOrigin,
  redactUrl,
  withholdShopifyAdminOrigin,
} from "../../server.js";
import prisma from "../db.server";
import {
  actionOriginWouldReject,
  parseSettingsIntent,
  SETTINGS_CREATE_TOKEN_INTENT,
} from "./action-origin";
import { DEMO_SHOP } from "./shop";

const shop = DEMO_SHOP;
const APP_HTTPS = "https://upt-plant-request-portal.onrender.com/app/settings.data";
const APP_HTTP = "http://upt-plant-request-portal.onrender.com/app/settings.data";

const originalApiKey = process.env.SHOPIFY_API_KEY;

function settingsActionArgs(body: Record<string, string>): ActionFunctionArgs {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.set(key, value);
  return {
    request: new Request("https://demo-shop.myshopify.com/app/settings", {
      method: "POST",
      body: form,
    }),
    params: {},
    context: {},
  } as ActionFunctionArgs;
}

type FakeRequest = { method: string; url: string; headers: Record<string, string> };

function fakeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): FakeRequest {
  return { method, url, headers };
}

describe("Settings token-create 400 is React Router CSRF, not the action", () => {
  it("rejects Origin admin.shopify.com against the app host — the production 400", () => {
    assert.equal(
      actionOriginWouldReject("https://admin.shopify.com", APP_HTTPS),
      true,
    );
  });

  it("rejects https Origin against http request.url — Render without trust proxy", () => {
    assert.equal(
      actionOriginWouldReject(
        "https://upt-plant-request-portal.onrender.com",
        APP_HTTP,
      ),
      true,
    );
  });

  it("accepts a same-origin https app POST", () => {
    assert.equal(
      actionOriginWouldReject(
        "https://upt-plant-request-portal.onrender.com",
        APP_HTTPS,
      ),
      false,
    );
  });

  it("accepts a missing Origin, which is how withheld proxy/admin POSTs pass", () => {
    assert.equal(actionOriginWouldReject(null, APP_HTTPS), false);
  });

  it("does not treat the Settings action itself as the 400 branch", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    const action = source.slice(
      source.indexOf("export const action"),
      source.indexOf("export default function Settings"),
    );
    assert.match(action, /create-mobile-token/);
    assert.match(action, /parseSettingsIntent/);
    assert.match(action, /Unknown settings action/);
    assert.doesNotMatch(action, /new Response\([^)]*400[^)]*create-mobile-token/);
  });
});

describe("embedded admin Origin withhold", () => {
  it("recognizes Settings single-fetch and other /app mutations", () => {
    assert.equal(isEmbeddedAdminPath("/app/settings.data"), true);
    assert.equal(isEmbeddedAdminPath("/app/settings"), true);
    assert.equal(isEmbeddedAdminPath("/app.data"), true);
    assert.equal(isEmbeddedAdminPath("/customer/submit.data"), false);
  });

  it("recognizes only Shopify Admin origins", () => {
    assert.equal(isShopifyAdminOrigin("https://admin.shopify.com"), true);
    assert.equal(
      isShopifyAdminOrigin("https://store.admin.shopify.com"),
      true,
    );
    assert.equal(
      isShopifyAdminOrigin("https://upt-plant-request-portal.onrender.com"),
      false,
    );
    assert.equal(isShopifyAdminOrigin("https://evil.example.com"), false);
  });

  it("withholds admin.shopify.com on POST /app/settings.data so CSRF can pass", () => {
    const req = fakeReq("POST", "/app/settings.data", {
      origin: "https://admin.shopify.com",
    });
    withholdShopifyAdminOrigin(req);
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers["x-shopify-admin-origin"], "https://admin.shopify.com");
    assert.equal(
      actionOriginWouldReject(req.headers.origin ?? null, APP_HTTPS),
      false,
    );
  });

  it("leaves an attacker Origin on /app so CSRF still rejects it", () => {
    const req = fakeReq("POST", "/app/settings.data", {
      origin: "https://evil.example.com",
    });
    withholdShopifyAdminOrigin(req);
    assert.equal(req.headers.origin, "https://evil.example.com");
    assert.equal(
      actionOriginWouldReject(req.headers.origin, APP_HTTPS),
      true,
    );
  });

  it("does not widen allowedActionOrigins and does set trust proxy", () => {
    const server = readFileSync(
      path.join(import.meta.dirname, "..", "..", "server.js"),
      "utf8",
    );
    assert.match(server, /app\.set\("trust proxy", 1\)/);
    assert.match(server, /withholdShopifyAdminOrigin/);
    assert.doesNotMatch(server, /allowedActionOrigins\s*:/);
  });

  it("keeps id_token out of the request log", () => {
    const logged = redactUrl("/app/settings.data?embedded=1&id_token=eyJhbGciOi.J9.sig");
    assert.equal(logged.includes("eyJhbGciOi"), false);
    assert.equal(logged.includes("embedded=1"), true);
  });
});

describe("Settings action token-create payload", () => {
  let settingsAction: ActionFunction;

  before(async () => {
    process.env.SHOPIFY_API_KEY = "devkey";
    process.env.SHOPIFY_API_SECRET ??= "devsecret";
    process.env.SHOPIFY_APP_URL ??= "http://localhost:3000";
    process.env.SCOPES ??= "write_products";
    ({ action: settingsAction } = await import("../routes/app.settings"));
    await prisma.adminMobileToken.deleteMany({
      where: { shop, label: { startsWith: "SettingsActionTest" } },
    });
  });

  after(async () => {
    await prisma.adminMobileToken.deleteMany({
      where: { shop, label: { startsWith: "SettingsActionTest" } },
    });
    if (originalApiKey === undefined) delete process.env.SHOPIFY_API_KEY;
    else process.env.SHOPIFY_API_KEY = originalApiKey;
  });

  it("parses the same fields the Settings create form submits", () => {
    const parsed = parseSettingsIntent("create-mobile-token");
    assert.deepEqual(parsed, {
      intent: SETTINGS_CREATE_TOKEN_INTENT,
      known: true,
    });
    const settings = readFileSync(
      path.join(import.meta.dirname, "..", "routes", "app.settings.tsx"),
      "utf8",
    );
    const form = settings.slice(
      settings.indexOf("data-create-mobile-token"),
      settings.indexOf("settings.mobileTokens.length"),
    );
    assert.match(form, /name="intent"/);
    assert.match(form, /value="create-mobile-token"/);
    assert.match(form, /name="mobileTokenLabel"/);
    assert.doesNotMatch(form, /name="action"/);
    assert.doesNotMatch(form, /name="shop"/);
    assert.doesNotMatch(form, /name="token"/);
  });

  it("creates exactly one token row and returns the one-time secret", async () => {
    const beforeCount = await prisma.adminMobileToken.count({
      where: { shop, label: "SettingsActionTest Phone", revokedAt: null },
    });

    const result = await settingsAction(
      settingsActionArgs({
        intent: "create-mobile-token",
        mobileTokenLabel: "SettingsActionTest Phone",
      }),
    );

    assert.ok(result && typeof result === "object");
    assert.equal(result instanceof Response, false);
    const payload = result as {
      newMobileToken?: { label: string; token: string };
    };
    assert.equal(payload.newMobileToken?.label, "SettingsActionTest Phone");
    assert.match(payload.newMobileToken?.token ?? "", /^upt_admin_[0-9a-f]{64}$/);

    const after = await prisma.adminMobileToken.findMany({
      where: { shop, label: "SettingsActionTest Phone", revokedAt: null },
    });
    assert.equal(after.length, beforeCount + 1);

    const listed = await prisma.adminMobileToken.findMany({
      where: { shop, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(listed[0]?.label, "SettingsActionTest Phone");
    assert.equal(listed[0]?.tokenHash.includes(payload.newMobileToken!.token), false);
  });

  it("returns HTTP 400 only for a malformed/unknown intent, not for token create", async () => {
    assert.equal(parseSettingsIntent("not-a-real-intent").known, false);
    const unknown = await settingsAction(
      settingsActionArgs({ intent: "not-a-real-intent" }),
    );
    assert.ok(unknown instanceof Response);
    assert.equal(unknown.status, 400);
    assert.equal(await unknown.text(), "Unknown settings action.");

    const created = await settingsAction(
      settingsActionArgs({
        intent: "create-mobile-token",
        mobileTokenLabel: "SettingsActionTest Other",
      }),
    );
    assert.equal(created instanceof Response, false);
  });

  it("treats a missing intent as save, not as the CSRF 400", async () => {
    assert.deepEqual(parseSettingsIntent(null), { intent: "save", known: true });
    const result = await settingsAction(settingsActionArgs({}));
    assert.equal(result instanceof Response, false);
    const payload = result as { saved?: boolean; section?: string };
    assert.equal(payload.saved, true);
    assert.equal(payload.section, "fedex");
  });
});
