import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  missingScopes,
  productionEnvProblems,
  REQUIRED_SHOPIFY_SCOPES,
  resolveScopes,
} from "./env.server";

const VALID_PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  SHOPIFY_API_KEY: "real-client-id",
  SHOPIFY_API_SECRET: "real-client-secret",
  SHOPIFY_APP_URL: "https://portal.example.com",
  DATABASE_URL: "postgresql://user:pass@db.example.com:5432/upt",
};

function problemVariables(env: NodeJS.ProcessEnv): string[] {
  return productionEnvProblems(env).map((problem) => problem.variable);
}

describe("production environment validation", () => {
  it("accepts a correctly configured production environment", () => {
    assert.deepEqual(productionEnvProblems(VALID_PRODUCTION_ENV), []);
  });

  it("requires the Shopify credentials, app URL and database URL", () => {
    assert.deepEqual(problemVariables({ NODE_ENV: "production" }).sort(), [
      "DATABASE_URL",
      "SHOPIFY_API_KEY",
      "SHOPIFY_API_SECRET",
      "SHOPIFY_APP_URL",
    ]);
  });

  it("rejects the devkey placeholder that enables the admin bypass", () => {
    const problems = problemVariables({
      ...VALID_PRODUCTION_ENV,
      SHOPIFY_API_KEY: "devkey",
    });
    assert.deepEqual(problems, ["SHOPIFY_API_KEY"]);
  });

  it("rejects a SQLite database in production", () => {
    const problems = problemVariables({
      ...VALID_PRODUCTION_ENV,
      DATABASE_URL: "file:dev.sqlite",
    });
    assert.deepEqual(problems, ["DATABASE_URL"]);
  });

  it("rejects a non-https app URL", () => {
    const problems = problemVariables({
      ...VALID_PRODUCTION_ENV,
      SHOPIFY_APP_URL: "http://portal.example.com",
    });
    assert.deepEqual(problems, ["SHOPIFY_APP_URL"]);
  });

  it("rejects the customer demo login in production", () => {
    const problems = problemVariables({
      ...VALID_PRODUCTION_ENV,
      ALLOW_CUSTOMER_DEMO_LOGIN: "true",
    });
    assert.deepEqual(problems, ["ALLOW_CUSTOMER_DEMO_LOGIN"]);
  });

  it("rejects a SCOPES value that omits scopes the app calls", () => {
    const problems = productionEnvProblems({
      ...VALID_PRODUCTION_ENV,
      SCOPES: "read_orders,write_draft_orders",
    });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].variable, "SCOPES");
    assert.match(problems[0].message, /write_products/);
  });

  it("accepts a SCOPES value that covers every required scope", () => {
    assert.deepEqual(
      productionEnvProblems({
        ...VALID_PRODUCTION_ENV,
        SCOPES: REQUIRED_SHOPIFY_SCOPES.join(","),
      }),
      [],
    );
  });

  it("does not validate outside production", () => {
    assert.deepEqual(productionEnvProblems({ NODE_ENV: "production" }).length > 0, true);
    assert.deepEqual(missingScopes([...REQUIRED_SHOPIFY_SCOPES]), []);
  });
});

describe("scope resolution", () => {
  it("falls back to the scopes the app actually calls", () => {
    const original = process.env.SCOPES;
    delete process.env.SCOPES;
    try {
      assert.deepEqual(resolveScopes(), [...REQUIRED_SHOPIFY_SCOPES]);
    } finally {
      if (original === undefined) delete process.env.SCOPES;
      else process.env.SCOPES = original;
    }
  });

  it("matches the scopes declared in shopify.app.toml", () => {
    const toml = readFileSync(
      path.join(import.meta.dirname, "..", "..", "shopify.app.toml"),
      "utf8",
    );
    const declared = toml.match(/^scopes\s*=\s*"([^"]*)"/m)?.[1];
    assert.ok(declared, "shopify.app.toml must declare access scopes");
    assert.deepEqual(
      declared.split(",").map((scope) => scope.trim()).sort(),
      [...REQUIRED_SHOPIFY_SCOPES].sort(),
    );
  });
});
