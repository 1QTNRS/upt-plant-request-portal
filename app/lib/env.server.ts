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
 * Sender used when EMAIL_FROM is unset. Lives here rather than in
 * emails.server.ts so environment.server.ts can name it in the Settings panel
 * without importing the outbox, which imports environment.server.ts back.
 */
export const DEFAULT_EMAIL_FROM =
  "UPT Plant Requests <noreply@unsolicitedplanttalks.com>";

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
  // Required to configure the app proxy that serves the storefront customer
  // portal. See https://shopify.dev/docs/apps/build/online-store/app-proxies
  "write_app_proxy",
] as const;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Connections each instance may open. Prisma otherwise sizes its pool as
 * `physical CPUs * 2 + 1`, counted from the machine the container runs on
 * rather than the fraction of a CPU the plan grants — Render publishes
 * RENDER_CPU_COUNT precisely because a process cannot see its own share. On a
 * big host that default is tens of connections per instance, against the 100 a
 * Render Postgres instance under 8 GB allows, so scaling out could exhaust the
 * database. Ten leaves room for far more instances than this portal will need.
 */
const POSTGRES_CONNECTION_LIMIT = 10;

/**
 * Render injects the database's connection string verbatim and a Blueprint
 * cannot append to it, so the pool size has to be applied here. An explicit
 * `connection_limit` in DATABASE_URL still wins.
 */
export function withConnectionLimit(url: string): string {
  if (!/^postgres(ql)?:\/\//i.test(url)) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${POSTGRES_CONNECTION_LIMIT}`;
}

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return withConnectionLimit(url);
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

/**
 * Everything a granted scope list actually covers.
 *
 * Shopify treats `write_x` as including `read_x` and does **not** echo the read
 * scope back in the granted list. A correctly installed store reports
 * `write_products` alone, so comparing the raw strings claims `read_products`
 * was refused. That put a permanent "this store has not approved …" warning on
 * every admin page of a store that had approved everything, training the
 * merchant to ignore the one message that matters when a scope really is
 * missing.
 */
function coveredScopes(granted: string[]): Set<string> {
  const covered = new Set<string>();
  for (const raw of granted) {
    const scope = raw.trim();
    if (!scope) continue;
    covered.add(scope);
    if (scope.startsWith("write_")) {
      covered.add(`read_${scope.slice("write_".length)}`);
    }
  }
  return covered;
}

/** Scopes the deployment is missing relative to what the app actually calls. */
export function missingScopes(granted: string[]): string[] {
  const covered = coveredScopes(granted);
  return REQUIRED_SHOPIFY_SCOPES.filter((scope) => !covered.has(scope));
}

/**
 * Explains what the merchant still has to approve, or null when the access
 * token already covers everything the app calls.
 *
 * Adding a scope to shopify.app.toml does not upgrade an existing token: the
 * merchant has to approve again. Until they do, the missing permission only
 * surfaces as an opaque GraphQL error at the moment someone approves an EXACT
 * PLANTS listing or uploads a photo, which is a poor way to find out.
 */
export function grantedScopeWarning(
  grantedScopes: string | null | undefined,
): string | null {
  // No recorded scope means no Shopify session (the local dev bypass), not a
  // token that granted nothing.
  if (!grantedScopes?.trim()) return null;

  const missing = missingScopes(grantedScopes.split(","));
  if (missing.length === 0) return null;

  return (
    `This store has not approved ${missing.join(", ")}. ` +
    "Reinstall or re-approve the app from the Shopify admin, or features that " +
    "need those permissions will fail."
  );
}

/**
 * Accepts what Resend accepts in `from`: a bare address, or a display name
 * followed by the address in angle brackets.
 */
export function isValidEmailFrom(value: string): boolean {
  const bracketed = /<([^<>]+)>\s*$/.exec(value.trim());
  const address = (bracketed ? bracketed[1] : value).trim();
  return /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(address);
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

  // Not listed as required above: an unset EMAIL_FROM falls back to
  // DEFAULT_EMAIL_FROM (surfaced in Settings by missingProductionSecrets), and
  // refusing to boot over it would take a running deploy down. A value Resend
  // rejects on every send is worth catching before the first offer email.
  const emailFrom = env.EMAIL_FROM?.trim();
  if (emailFrom && !isValidEmailFrom(emailFrom)) {
    problems.push({
      variable: "EMAIL_FROM",
      message:
        'must be an email address, optionally with a display name: "UPT Plant Requests <noreply@example.com>"',
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
