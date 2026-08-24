import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { loader as requestsLoader } from "../routes/api.mobile.admin.requests._index";
import { loader as sessionLoader } from "../routes/api.mobile.admin.session";
import {
  ADMIN_MOBILE_TOKEN_PREFIX,
  authenticateAdminMobile,
  createAdminMobileToken,
  listAdminMobileTokens,
  readBearerToken,
  revokeAdminMobileToken,
} from "./admin-mobile-auth.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-mobile-admin`;

function requestWithBearer(token?: string) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://app.example/api/mobile/admin/session", { headers });
}

function loaderArgs(request: Request): LoaderFunctionArgs {
  return { request, params: {}, context: {} } as LoaderFunctionArgs;
}

describe("admin mobile bearer tokens", () => {
  before(async () => {
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
  });

  after(async () => {
    await prisma.adminMobileToken.deleteMany({ where: { shop } });
  });

  it("reads a Bearer token and ignores a missing header", () => {
    assert.equal(readBearerToken(requestWithBearer("abc")), "abc");
    assert.equal(readBearerToken(new Request("https://app.example/x")), null);
  });

  it("creates a token that can authenticate, then stops after revoke", async () => {
    const created = await createAdminMobileToken(shop, "Warehouse iPhone");
    assert.match(created.token, new RegExp(`^${ADMIN_MOBILE_TOKEN_PREFIX}[0-9a-f]{64}$`));
    assert.equal(created.record.label, "Warehouse iPhone");

    const stored = await prisma.adminMobileToken.findUnique({
      where: { id: created.record.id },
    });
    assert.ok(stored);
    assert.equal(stored.tokenHash.includes(created.token), false);

    const authed = await authenticateAdminMobile(requestWithBearer(created.token));
    assert.deepEqual(authed, { shop, tokenId: created.record.id });

    const listed = await listAdminMobileTokens(shop);
    assert.equal(listed.length, 1);
    assert.ok(listed[0].lastUsedAt);

    await revokeAdminMobileToken(shop, created.record.id);
    assert.equal(await authenticateAdminMobile(requestWithBearer(created.token)), null);
    assert.equal((await listAdminMobileTokens(shop)).length, 0);
  });

  it("refuses a forged or empty bearer token", async () => {
    assert.equal(await authenticateAdminMobile(requestWithBearer()), null);
    assert.equal(
      await authenticateAdminMobile(requestWithBearer(`${ADMIN_MOBILE_TOKEN_PREFIX}${"ab".repeat(32)}`)),
      null,
    );
  });
});

describe("admin mobile API routes", () => {
  it("returns 401 without a token", async () => {
    const session = await sessionLoader(loaderArgs(requestWithBearer()));
    assert.equal(session.status, 401);

    const list = await requestsLoader(
      loaderArgs(new Request("https://app.example/api/mobile/admin/requests")),
    );
    assert.equal(list.status, 401);
  });
});
