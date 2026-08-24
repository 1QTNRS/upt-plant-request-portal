import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APP_PROXY_BASE_PATH, CUSTOMER_PORTAL_PATH } from "./app-proxy";
import { REQUIRED_SHOPIFY_SCOPES } from "./env.server";

/**
 * Checks shopify.app.toml against the app it configures.
 *
 * Shopify's TOML cannot read environment variables, so the production URLs are
 * committed. A wrong one fails in a way that is hard to attribute: OAuth loops,
 * or the storefront portal 404s, and only on the real store.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const PRODUCTION_URL = "https://upt-plant-request-portal.onrender.com";

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** The text of one `[table]` section, so a key cannot be read from the wrong one. */
function section(toml: string, table: string): string {
  const header = new RegExp(`(?:^|\\n)\\[${table}\\]\\s*\\n`);
  const match = header.exec(toml);
  assert.ok(match, `${table} table is missing`);
  const start = (match.index ?? 0) + match[0].length;
  const rest = toml.slice(start);
  const end = rest.search(/^\[[a-z]/m);
  return end === -1 ? rest : rest.slice(0, end);
}

function str(toml: string, key: string): string | undefined {
  return toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
}

function bool(toml: string, key: string): boolean | undefined {
  const raw = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)`, "m"))?.[1];
  return raw === undefined ? undefined : raw === "true";
}

function scopeList(toml: string): string[] {
  return (str(toml, "scopes") ?? "").split(",").map((scope) => scope.trim());
}

function strList(toml: string, key: string): string[] {
  const block = toml.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("shopify.app.toml (production)", () => {
  const toml = read("shopify.app.toml");

  it("points at the permanent Render hostname", () => {
    assert.equal(str(toml, "application_url"), PRODUCTION_URL);
  });

  it("has no leftover template, tunnel or localhost URL", () => {
    for (const stale of ["shopify.dev/apps", "trycloudflare.com", "ngrok", "localhost"]) {
      assert.ok(!toml.includes(stale), `shopify.app.toml still references ${stale}`);
    }
  });

  it("registers both OAuth callbacks the app template serves", () => {
    assert.deepEqual(strList(section(toml, "auth"), "redirect_urls"), [
      `${PRODUCTION_URL}/auth/callback`,
      `${PRODUCTION_URL}/auth/shopify/callback`,
    ]);
  });

  it("routes the app proxy to an absolute URL on the same host", () => {
    // A relative path is not a valid URL and leaves the storefront portal
    // unroutable, which is how this was previously configured.
    const url = str(section(toml, "app_proxy"), "url");
    assert.equal(url, `${PRODUCTION_URL}${CUSTOMER_PORTAL_PATH}`);
    assert.match(url ?? "", /^https:\/\//);
  });

  it("keeps the storefront path the app builds customer links for", () => {
    const proxy = section(toml, "app_proxy");
    assert.equal(
      `/${str(proxy, "prefix")}/${str(proxy, "subpath")}`,
      APP_PROXY_BASE_PATH,
    );
  });

  it("does not let a dev session repoint the live app", () => {
    assert.equal(
      bool(section(toml, "build"), "automatically_update_urls_on_dev"),
      false,
    );
  });

  it("requests exactly the scopes the app calls", () => {
    const scopes = str(section(toml, "access_scopes"), "scopes") ?? "";
    assert.deepEqual(
      scopes.split(",").map((scope) => scope.trim()).sort(),
      [...REQUIRED_SHOPIFY_SCOPES].sort(),
    );
  });

  it("requests write_inventory, without which a listing cannot hold stock", () => {
    // Same shape as the check above, and the same failure mode: an EXACT PLANTS
    // listing is one physical plant, and without this scope it cannot be given
    // one unit of tracked stock, so approving one dies at the inventory step.
    assert.ok(
      scopeList(section(toml, "access_scopes")).includes("write_inventory"),
      "one plant, one unit of stock requires the write_inventory access scope",
    );
  });

  it("requests write_app_proxy, without which [app_proxy] does nothing", () => {
    // Checked separately from the list above, which only proves the TOML and
    // REQUIRED_SHOPIFY_SCOPES agree and so stays green when both omit a scope.
    // Omitting this one leaves the storefront portal 404ing on the real shop
    // while every other check passes.
    assert.ok(toml.includes("[app_proxy]"), "expected an app proxy to configure");
    assert.ok(
      scopeList(section(toml, "access_scopes")).includes("write_app_proxy"),
      "an app proxy requires the write_app_proxy access scope",
    );
  });

  it("declares the one Events subscription CLI 4.6+ requires to deploy", () => {
    const events = section(toml, "events");
    assert.equal(str(events, "api_version"), "unstable");
    assert.equal(str(events, "handle"), "cli-required-product-create");
    assert.equal(str(events, "topic"), "Product");
    assert.deepEqual(strList(events, "actions"), ["create"]);
    assert.equal(str(events, "uri"), "/events/acknowledge");
    assert.equal(
      (toml.match(/^\s*\[\[events\.subscription\]\]/gm) ?? []).length,
      1,
      "only the CLI-required Product create subscription",
    );
  });

  it("serves every configured webhook or Events URI as a route", () => {
    const uris = [...toml.matchAll(/^\s*uri = "([^"]+)"/gm)].map((match) => match[1]);
    assert.ok(uris.length >= 7, "expected the webhook URIs plus the Events acknowledge URI");
    for (const uri of uris) {
      const route = `${uri.replace(/^\//, "").replace(/\//g, ".")}.tsx`;
      assert.ok(
        existsSync(path.join(REPO_ROOT, "app", "routes", route)),
        `${uri} has no route (looked for app/routes/${route})`,
      );
    }
  });

  it("acknowledges Events deliveries through authenticate.webhook", () => {
    const source = read("app/routes/events.acknowledge.tsx");
    assert.match(source, /authenticate\.webhook/);
    assert.match(source, /status: 200/);
  });
});

describe("shopify.app.dev.toml (development)", () => {
  const dev = read("shopify.app.dev.toml");
  const production = read("shopify.app.toml");

  it("lets the CLI manage tunnel URLs", () => {
    assert.equal(
      bool(section(dev, "build"), "automatically_update_urls_on_dev"),
      true,
    );
  });

  it("is not the production app", () => {
    // `shopify app dev` rewrites the app's URLs in the Partner dashboard, so
    // sharing the production client_id would take the live app down for the
    // duration of a dev session.
    assert.notEqual(str(dev, "client_id"), str(production, "client_id"));
  });

  it("never points at the production host", () => {
    assert.ok(
      !dev.includes("upt-plant-request-portal.onrender.com"),
      "the dev config must not reference the production service",
    );
  });

  it("requests the same scopes as production", () => {
    assert.equal(
      str(section(dev, "access_scopes"), "scopes"),
      str(section(production, "access_scopes"), "scopes"),
    );
  });

  it("uses the same webhook API version as production", () => {
    assert.equal(
      str(section(dev, "webhooks"), "api_version"),
      str(section(production, "webhooks"), "api_version"),
    );
  });

  it("uses the same CLI-required Events placeholder as production", () => {
    assert.equal(
      str(section(dev, "events"), "handle"),
      str(section(production, "events"), "handle"),
    );
    assert.equal(
      str(section(dev, "events"), "uri"),
      str(section(production, "events"), "uri"),
    );
  });

  it("keeps the same app proxy path, so customer links behave the same", () => {
    const devProxy = section(dev, "app_proxy");
    const prodProxy = section(production, "app_proxy");
    assert.equal(str(devProxy, "prefix"), str(prodProxy, "prefix"));
    assert.equal(str(devProxy, "subpath"), str(prodProxy, "subpath"));
  });
});
