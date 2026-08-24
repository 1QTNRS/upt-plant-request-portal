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
import { missingProductionSecrets } from "./environment.server";

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

  it("rejects an EMAIL_FROM Resend cannot send from", () => {
    for (const value of ["noreply", "UPT Plant Requests", "noreply@localhost"]) {
      assert.deepEqual(
        problemVariables({ ...VALID_PRODUCTION_ENV, EMAIL_FROM: value }),
        ["EMAIL_FROM"],
        `${value} should be rejected`,
      );
    }
  });

  it("accepts EMAIL_FROM with or without a display name", () => {
    for (const value of [
      "noreply@unsolicitedplanttalks.com",
      "UPT Plant Requests <noreply@unsolicitedplanttalks.com>",
    ]) {
      assert.deepEqual(
        productionEnvProblems({ ...VALID_PRODUCTION_ENV, EMAIL_FROM: value }),
        [],
        `${value} should be accepted`,
      );
    }
  });

  it("does not refuse to boot merely because EMAIL_FROM is unset", () => {
    // It falls back to DEFAULT_EMAIL_FROM, and taking a running deploy down
    // over it would be worse than the fallback. Settings reports it instead.
    assert.deepEqual(productionEnvProblems(VALID_PRODUCTION_ENV), []);

    const original = process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM;
    try {
      const reported = missingProductionSecrets().find(
        (secret) => secret.name === "EMAIL_FROM",
      );
      assert.ok(reported, "Settings must name it");
      assert.match(reported.reason, /noreply@unsolicitedplanttalks\.com/);
    } finally {
      if (original !== undefined) process.env.EMAIL_FROM = original;
    }
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

  it("stays silent for the scope string a correctly installed store reports", () => {
    // Verbatim from the offline session on upt-plant-request-dev.myshopify.com
    // after approving every requested scope, plus write_inventory, which the
    // app started calling later. Shopify folds each `read_x` into the `write_x`
    // that implies it.
    assert.equal(
      grantedScopeWarning(
        "read_customers,read_orders,write_app_proxy,write_draft_orders," +
          "write_files,write_inventory,write_products,write_publications",
      ),
      null,
    );
  });

  it("asks a token issued before write_inventory to re-approve", () => {
    const warning = grantedScopeWarning(
      "read_customers,read_orders,write_app_proxy,write_draft_orders," +
        "write_files,write_products,write_publications",
    );
    assert.match(warning ?? "", /write_inventory/);
  });

  it("counts a write scope as granting the read scope it implies", () => {
    assert.deepEqual(missingScopes(["write_products"]).includes("read_products"), false);
  });

  it("still reports a read scope with no write scope to imply it", () => {
    assert.deepEqual(missingScopes(["write_products"]).includes("read_orders"), true);
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
    const declared = readToml()
      .split("[events]")[0]
      .match(/^api_version\s*=\s*"([^"]*)"/m)?.[1];
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
