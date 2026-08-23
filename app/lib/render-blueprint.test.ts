import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { REQUIRED_SHOPIFY_SCOPES } from "./env.server";

/**
 * Checks render.yaml against the app it deploys. A blueprint only fails when
 * someone applies it, so drift here — a renamed route, a moved script, a
 * removed environment variable — would surface as a broken production deploy.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

type EnvVar = {
  key?: string;
  value?: string;
  sync?: boolean;
  generateValue?: boolean;
  fromDatabase?: { name: string; property: string };
  fromService?: { name: string; type: string; envVarKey?: string; property?: string };
  fromGroup?: string;
};

type Service = {
  type: string;
  name: string;
  runtime?: string;
  plan?: string;
  schedule?: string;
  buildCommand?: string;
  startCommand?: string;
  dockerCommand?: string;
  dockerfilePath?: string;
  healthCheckPath?: string;
  branch?: string;
  autoDeployTrigger?: string;
  envVars?: EnvVar[];
};

type Blueprint = {
  databases?: Array<{
    name: string;
    databaseName?: string;
    postgresMajorVersion?: string;
    plan?: string;
    ipAllowList?: unknown[];
  }>;
  services?: Service[];
};

const blueprint = parse(
  readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8"),
) as Blueprint;

const database = blueprint.databases?.[0];
const web = blueprint.services?.find((service) => service.type === "web");
const cron = blueprint.services?.find((service) => service.type === "cron");

function envVar(service: Service | undefined, key: string): EnvVar | undefined {
  return service?.envVars?.find((entry) => entry.key === key);
}

describe("Render blueprint: database", () => {
  it("declares exactly one PostgreSQL database", () => {
    assert.equal(blueprint.databases?.length, 1);
    assert.ok(database);
  });

  it("pins the PostgreSQL major version the migrations are tested against", () => {
    assert.equal(database?.postgresMajorVersion, "16");
  });

  it("does not use the free tier, which is deleted after 30 days", () => {
    // The database is the only record of every plant request.
    assert.notEqual(database?.plan, "free");
    assert.ok(database?.plan, "an explicit plan avoids surprises on apply");
  });

  it("is reachable only on the private network", () => {
    assert.deepEqual(database?.ipAllowList, []);
  });
});

describe("Render blueprint: web service", () => {
  it("builds the committed Dockerfile", () => {
    assert.equal(web?.runtime, "docker");
    assert.ok(web?.dockerfilePath);
    assert.ok(
      existsSync(path.join(REPO_ROOT, web.dockerfilePath!)),
      `${web?.dockerfilePath} does not exist`,
    );
  });

  it("health checks a route the app actually serves", () => {
    assert.equal(web?.healthCheckPath, "/healthz");
    assert.ok(
      existsSync(path.join(REPO_ROOT, "app", "routes", "healthz.tsx")),
      "healthCheckPath points at a route that does not exist",
    );
    assert.ok(
      existsSync(path.join(REPO_ROOT, "app", "routes", "versionz.ts")),
      "post-deploy smoke needs /versionz",
    );
  });

  it("serves on the port the Dockerfile exposes", () => {
    const dockerfile = readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    const exposed = dockerfile.match(/^EXPOSE\s+(\d+)/m)?.[1];
    assert.equal(envVar(web, "PORT")?.value, exposed);
  });

  it("takes DATABASE_URL from the declared database", () => {
    const url = envVar(web, "DATABASE_URL");
    assert.equal(url?.fromDatabase?.property, "connectionString");
    assert.equal(url?.fromDatabase?.name, database?.name);
  });

  it("declares every value the app refuses to start without", () => {
    // Mirrors the required list in productionEnvProblems.
    for (const key of [
      "SHOPIFY_API_KEY",
      "SHOPIFY_API_SECRET",
      "SHOPIFY_APP_URL",
      "DATABASE_URL",
    ]) {
      assert.ok(envVar(web, key), `render.yaml does not set ${key}`);
    }
  });

  it("prompts for secrets instead of committing them", () => {
    for (const key of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "RESEND_API_KEY"]) {
      const entry = envVar(web, key);
      assert.equal(entry?.sync, false, `${key} must use sync: false`);
      assert.equal(entry?.value, undefined, `${key} must not have a committed value`);
    }
  });

  it("has Render generate CRON_SECRET rather than asking a human for one", () => {
    // It is shared between two Render services and nothing outside Render needs
    // it, so it is one less secret to invent, paste and store.
    const entry = envVar(web, "CRON_SECRET");
    assert.equal(entry?.generateValue, true);
    assert.equal(entry?.value, undefined);
    assert.equal(entry?.sync, undefined);
  });

  it("never enables the demo login or the dev bypass", () => {
    // The app refuses to boot on either, but they should not appear at all.
    assert.equal(envVar(web, "ALLOW_CUSTOMER_DEMO_LOGIN"), undefined);
    assert.equal(envVar(web, "DEV_SHOP"), undefined);
    assert.notEqual(envVar(web, "SHOPIFY_API_KEY")?.value, "devkey");
  });

  it("leaves SCOPES unset so the code list is used", () => {
    // REQUIRED_SHOPIFY_SCOPES is asserted against shopify.app.toml elsewhere;
    // duplicating it here would add a third place to keep in sync.
    assert.equal(envVar(web, "SCOPES"), undefined);
    assert.ok(REQUIRED_SHOPIFY_SCOPES.length > 0);
  });
});

describe("Render blueprint: auto-deploys", () => {
  // Render's documented values. `autoDeploy` is deprecated in favour of this
  // field, and Render silently rejects an unrecognised value on apply.
  const DOCUMENTED_TRIGGERS = ["commit", "checksPass", "off"];

  for (const service of blueprint.services ?? []) {
    it(`${service.name} waits for CI instead of deploying every commit`, () => {
      assert.ok(
        DOCUMENTED_TRIGGERS.includes(service.autoDeployTrigger ?? ""),
        `autoDeployTrigger "${service.autoDeployTrigger}" is not one of ${DOCUMENTED_TRIGGERS.join(", ")}`,
      );
      // CI runs the full suite against both SQLite and PostgreSQL. Omitting the
      // field would default a new service to `commit`, which puts unverified
      // code in front of the store.
      assert.equal(service.autoDeployTrigger, "checksPass");
      assert.equal(
        service.branch,
        "main",
        `${service.name} must auto-deploy main, not a leftover working branch`,
      );
    });
  }
});

describe("Render blueprint: cron job", () => {
  it("runs a script that exists", () => {
    const command = cron?.startCommand ?? cron?.dockerCommand ?? "";
    const script = command.match(/(scripts\/[\w.-]+)/)?.[1];
    assert.ok(script, `could not find a script in "${command}"`);
    assert.ok(
      existsSync(path.join(REPO_ROOT, script)),
      `${script} does not exist`,
    );
  });

  it("is scheduled with a five-field cron expression", () => {
    assert.ok(cron?.schedule, "a cron job requires a schedule");
    assert.equal(cron!.schedule!.trim().split(/\s+/).length, 5);
  });

  it("does not use the free plan, which Render forbids for cron jobs", () => {
    assert.ok(cron?.plan);
    assert.notEqual(cron?.plan, "free");
  });

  it("reads CRON_SECRET from the web service so there is one value to rotate", () => {
    const secret = envVar(cron, "CRON_SECRET");
    assert.equal(secret?.fromService?.name, web?.name);
    assert.equal(secret?.fromService?.type, "web");
    assert.equal(secret?.fromService?.envVarKey, "CRON_SECRET");
    assert.equal(secret?.value, undefined);
  });

  it("learns the web service hostname, which cron jobs are not given", () => {
    // RENDER_EXTERNAL_URL is empty for non-web services.
    const hostname = envVar(cron, "APP_HOSTNAME");
    assert.equal(hostname?.fromService?.envVarKey, "RENDER_EXTERNAL_HOSTNAME");
    assert.equal(hostname?.fromService?.name, web?.name);
  });

  it("pins the Node version instead of letting Render infer one", () => {
    // package.json `engines` has no upper bound (">=22.12"), and Render resolves
    // it with node-version-alias, which returns the newest release in existence.
    // Without this pin the job would silently follow Node's release train.
    const pinned = envVar(cron, "NODE_VERSION")?.value;
    assert.ok(pinned, "the cron job must pin NODE_VERSION");
    const dockerfile = readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    const imageMajor = dockerfile.match(/^FROM node:(\d+)/m)?.[1];
    assert.equal(
      pinned.split(".")[0],
      imageMajor,
      "the cron job runs a different Node major than the web service image",
    );
  });

  it("skips the dependency install, having no dependencies to install", () => {
    assert.equal(envVar(cron, "SKIP_INSTALL_DEPS")?.value, "true");
    const script = readFileSync(
      path.join(REPO_ROOT, "scripts", "run-offer-maintenance.mjs"),
      "utf8",
    );
    for (const [, specifier] of script.matchAll(/^import .* from "([^"]+)";/gm)) {
      assert.ok(
        specifier.startsWith("node:"),
        `${specifier} is not a builtin, so SKIP_INSTALL_DEPS would break the job`,
      );
    }
  });

  it("posts to the route the app serves", () => {
    const script = readFileSync(
      path.join(REPO_ROOT, "scripts", "run-offer-maintenance.mjs"),
      "utf8",
    );
    const requestPath = script.match(/const PATH = "([^"]+)"/)?.[1];
    assert.equal(requestPath, "/cron/offer-maintenance");
    assert.ok(
      existsSync(
        path.join(REPO_ROOT, "app", "routes", "cron.offer-maintenance.tsx"),
      ),
      "the cron script targets a route that does not exist",
    );
  });
});

describe("Render runbook", () => {
  /** Every value Render will prompt for, across all services. */
  const prompted = (blueprint.services ?? [])
    .flatMap((service) => service.envVars ?? [])
    .filter((entry) => entry.sync === false)
    .map((entry) => entry.key)
    .filter((key): key is string => Boolean(key))
    .sort();

  /** Keys named in the runbook's "supply the prompted secrets" table. */
  const documented = (() => {
    const doc = readFileSync(
      path.join(REPO_ROOT, "docs", "PRODUCTION_DEPLOYMENT.md"),
      "utf8",
    );
    const section = doc.slice(
      doc.indexOf("## 2. Supply the prompted secrets"),
      doc.indexOf("You do **not** need to set"),
    );
    return [...section.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm)]
      .map((match) => match[1])
      .sort();
  })();

  // The runbook is the only place that tells the operator what Render will ask
  // for. If it drifts from the blueprint they either miss a value or hunt for
  // one that no longer exists.
  it("documents exactly the values Render prompts for", () => {
    assert.deepEqual(documented, prompted);
  });

  it("states the right number of prompted values", () => {
    const doc = readFileSync(
      path.join(REPO_ROOT, "docs", "PRODUCTION_DEPLOYMENT.md"),
      "utf8",
    );
    const words = [
      "zero", "one", "two", "three", "four", "five",
      "six", "seven", "eight", "nine", "ten",
    ];
    assert.match(
      doc,
      new RegExp(`Supply the ${words[prompted.length]} prompted secret`),
      `the summary table should say "${words[prompted.length]} prompted secret values"`,
    );
  });
});
