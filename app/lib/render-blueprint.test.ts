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
    for (const key of [
      "SHOPIFY_API_KEY",
      "SHOPIFY_API_SECRET",
      "CRON_SECRET",
      "RESEND_API_KEY",
    ]) {
      const entry = envVar(web, key);
      assert.equal(entry?.sync, false, `${key} must use sync: false`);
      assert.equal(entry?.value, undefined, `${key} must not have a committed value`);
    }
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
