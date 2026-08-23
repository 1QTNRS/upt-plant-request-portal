import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  signSmokeToken,
  smokeAdminContext,
  smokeTokenIsValid,
  SMOKE_HEADER,
} from "./smoke-auth.server";
import { APPROVED_SMOKE_SHOP } from "./pr-risk";

const SECRET = "smoke-test-secret-ok";

describe("smoke admin token", () => {
  const previous = process.env.SMOKE_TEST_SECRET;

  const previousAllow = process.env.ALLOW_SMOKE_ADMIN;

  before(() => {
    process.env.SMOKE_TEST_SECRET = SECRET;
    process.env.ALLOW_SMOKE_ADMIN = "true";
  });

  after(() => {
    if (previous == null) delete process.env.SMOKE_TEST_SECRET;
    else process.env.SMOKE_TEST_SECRET = previous;
    if (previousAllow == null) delete process.env.ALLOW_SMOKE_ADMIN;
    else process.env.ALLOW_SMOKE_ADMIN = previousAllow;
  });

  it("accepts a fresh token and only yields the approved shop", () => {
    const token = signSmokeToken(1_700_000_000, SECRET);
    assert.ok(token);
    assert.equal(smokeTokenIsValid(token, 1_700_000_000, SECRET), true);
    const request = new Request("https://example.test/app", {
      headers: { [SMOKE_HEADER]: token! },
    });
    assert.deepEqual(smokeAdminContext(request), { shop: APPROVED_SMOKE_SHOP });
  });

  it("rejects a missing secret, a short secret, and an expired token", () => {
    assert.equal(signSmokeToken(1, "short"), null);
    const token = signSmokeToken(1_700_000_000, SECRET);
    assert.equal(smokeTokenIsValid(token, 1_700_000_000 + 8 * 60 * 60, SECRET), false);
    const request = new Request("https://example.test/app");
    const previousSecret = process.env.SMOKE_TEST_SECRET;
    delete process.env.SMOKE_TEST_SECRET;
    assert.equal(smokeAdminContext(request), null);
    process.env.SMOKE_TEST_SECRET = previousSecret;
    const authed = new Request("https://example.test/app", {
      headers: { [SMOKE_HEADER]: token! },
    });
    delete process.env.ALLOW_SMOKE_ADMIN;
    assert.equal(signSmokeToken(), null);
    assert.equal(smokeAdminContext(authed), null);
    process.env.ALLOW_SMOKE_ADMIN = "true";
  });
});
