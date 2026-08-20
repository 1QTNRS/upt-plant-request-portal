/**
 * Environment contract for the portal.
 *
 * A misconfigured production deploy is the failure mode this guards against:
 * missing secrets silently degrade into demo behaviour (unsigned cookies, demo
 * shop, no Shopify session), which is far worse than refusing to boot.
 */

/** Matches scripts/prisma.mjs so the CLI and the server agree on the dev default. */
export const DEV_DATABASE_URL = "file:dev.sqlite";

/**
 * Kept in code, not only in shopify.app.toml, so the runtime OAuth request and
 * the deployed app configuration cannot drift. Must equal the `scopes` value in
 * shopify.app.toml — `app/lib/env.server.test.ts` asserts that.
 */
export const REQUIRED_SHOPIFY_SCOPES = [
  "write_draft_orders",
  "read_draft_orders",
  "read_orders",
  "read_customers",
  "write_files",
  "read_files",
  "read_products",
  "write_products",
  "read_publications",
  "write_publications",
] as const;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (isProduction()) {
    throw new Error(
      "DATABASE_URL is required in production. Set it to a PostgreSQL connection string.",
    );
  }
  return DEV_DATABASE_URL;
}

export function isSqliteDatabaseUrl(url: string): boolean {
  return url.startsWith("file:");
}

export function resolveScopes(): string[] {
  const configured = process.env.SCOPES?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return configured?.length ? configured : [...REQUIRED_SHOPIFY_SCOPES];
}

/** Scopes the deployment is missing relative to what the app actually calls. */
export function missingScopes(granted: string[]): string[] {
  const set = new Set(granted.map((scope) => scope.trim()));
  return REQUIRED_SHOPIFY_SCOPES.filter((scope) => !set.has(scope));
}

export type EnvProblem = { variable: string; message: string };

/**
 * Pure so it can be unit tested. `assertProductionEnv` applies it to
 * `process.env` at module load.
 */
export function productionEnvProblems(env: NodeJS.ProcessEnv): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const required = [
    ["SHOPIFY_API_KEY", "the Client ID from the Shopify Partner dashboard"],
    ["SHOPIFY_API_SECRET", "the Client secret from the Shopify Partner dashboard"],
    ["SHOPIFY_APP_URL", "the public HTTPS URL this app is served from"],
    ["DATABASE_URL", "a PostgreSQL connection string"],
  ] as const;

  for (const [variable, description] of required) {
    if (!env[variable]?.trim()) {
      problems.push({ variable, message: `must be set to ${description}` });
    }
  }

  if (env.SHOPIFY_API_KEY === "devkey") {
    problems.push({
      variable: "SHOPIFY_API_KEY",
      message: "must not be the `devkey` placeholder, which enables the local admin bypass",
    });
  }

  const appUrl = env.SHOPIFY_APP_URL?.trim();
  if (appUrl && !appUrl.startsWith("https://")) {
    problems.push({
      variable: "SHOPIFY_APP_URL",
      message: "must be an https:// URL; Shopify rejects http:// app URLs",
    });
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl && isSqliteDatabaseUrl(databaseUrl)) {
    problems.push({
      variable: "DATABASE_URL",
      message:
        "must not be a SQLite file in production; container filesystems are ephemeral and SQLite cannot be shared between instances",
    });
  }

  if (env.ALLOW_CUSTOMER_DEMO_LOGIN === "true") {
    problems.push({
      variable: "ALLOW_CUSTOMER_DEMO_LOGIN",
      message: "must not be enabled in production; it lets anyone sign in as the demo customer",
    });
  }

  if (env.SCOPES?.trim()) {
    const missing = missingScopes(env.SCOPES.split(","));
    if (missing.length > 0) {
      problems.push({
        variable: "SCOPES",
        message: `is missing scopes the app calls: ${missing.join(", ")}`,
      });
    }
  }

  return problems;
}

/** Throws on the first production boot if the deployment is misconfigured. */
export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = productionEnvProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start: invalid production environment.\n${problems
      .map((problem) => `  - ${problem.variable} ${problem.message}`)
      .join("\n")}`,
  );
}
