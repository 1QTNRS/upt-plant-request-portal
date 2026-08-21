import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  grantedScopeWarning,
  missingScopes,
  productionEnvProblems,
  REQUIRED_SHOPIFY_SCOPES,
  resolveScopes,
  withConnectionLimit,
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

describe("database connection pool", () => {
  // Prisma's default pool is sized from the host's CPU count, not the fraction
  // of a CPU the plan grants, and a Render Postgres instance under 8 GB accepts
  // 100 connections in total.
  it("caps the pool on the connection string Render injects", () => {
    const limited = withConnectionLimit(
      "postgresql://user:pass@dpg-abc123-a:5432/upt_portal",
    );
    assert.match(limited, /\?connection_limit=\d+$/);
    const limit = Number(limited.match(/connection_limit=(\d+)/)![1]);
    assert.ok(limit > 0 && limit <= 20, `${limit} is not a sane pool size`);
  });

  it("appends to a connection string that already has parameters", () => {
    assert.equal(
      withConnectionLimit("postgresql://u:p@host:5432/db?sslmode=require"),
      "postgresql://u:p@host:5432/db?sslmode=require&connection_limit=10",
    );
  });

  it("leaves an explicitly configured limit alone", () => {
    const url = "postgresql://u:p@host:5432/db?connection_limit=25";
    assert.equal(withConnectionLimit(url), url);
  });

  it("does not touch a SQLite URL, which has no pool", () => {
    assert.equal(withConnectionLimit("file:dev.sqlite"), "file:dev.sqlite");
  });
});

describe("granted scope warning", () => {
  it("is silent when the token covers everything the app calls", () => {
    assert.equal(grantedScopeWarning(REQUIRED_SHOPIFY_SCOPES.join(",")), null);
  });

  it("names the scopes the merchant still has to approve", () => {
    const warning = grantedScopeWarning(
      "read_orders,write_draft_orders,read_draft_orders,read_customers",
    );
    assert.match(warning ?? "", /write_products/);
    assert.match(warning ?? "", /write_publications/);
    assert.match(warning ?? "", /re-approve/i);
  });

  it("tolerates the whitespace Shopify's scope strings can carry", () => {
    assert.equal(
      grantedScopeWarning(REQUIRED_SHOPIFY_SCOPES.join(", ")),
      null,
    );
  });

  it("stays silent when there is no Shopify session at all", () => {
    // The local dev bypass has no session; that is not a token granting nothing.
    for (const value of [null, undefined, "", "   "]) {
      assert.equal(grantedScopeWarning(value), null);
    }
  });

  it("ignores extra scopes the store granted beyond what is needed", () => {
    assert.equal(
      grantedScopeWarning(`${REQUIRED_SHOPIFY_SCOPES.join(",")},read_themes`),
      null,
    );
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
    const declared = readToml().match(/^scopes\s*=\s*"([^"]*)"/m)?.[1];
    assert.ok(declared, "shopify.app.toml must declare access scopes");
    assert.deepEqual(
      declared.split(",").map((scope) => scope.trim()).sort(),
      [...REQUIRED_SHOPIFY_SCOPES].sort(),
    );
  });
});

function readToml(): string {
  return readFileSync(
    path.join(import.meta.dirname, "..", "..", "shopify.app.toml"),
    "utf8",
  );
}

describe("shopify.app.toml webhooks", () => {
  it("declares the webhook API version the Admin client uses", () => {
    const declared = readToml().match(/^api_version\s*=\s*"([^"]*)"/m)?.[1];
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "shopify.server.ts"),
      "utf8",
    );
    // Mismatched versions mean webhook payload shapes can drift from the
    // shapes the Admin API client reads.
    const constant = source.match(/export const apiVersion = ApiVersion\.(\w+)/)?.[1];
    const expected = { October25: "2025-10", January26: "2026-01", April26: "2026-04" }[
      constant ?? ""
    ];
    assert.ok(expected, `Add ApiVersion.${constant} to this test's version map`);
    assert.equal(declared, expected);
  });

  it("subscribes to all three mandatory compliance topics", () => {
    const toml = readToml();
    for (const topic of [
      "customers/data_request",
      "customers/redact",
      "shop/redact",
    ]) {
      assert.match(
        toml,
        new RegExp(`compliance_topics\\s*=\\s*\\[[^\\]]*"${topic}"`),
        `shopify.app.toml must subscribe to ${topic}`,
      );
    }
  });

  it("subscribes to the orders/paid topic that closes a request", () => {
    assert.match(readToml(), /topics\s*=\s*\[\s*"orders\/paid"\s*\]/);
  });
});
