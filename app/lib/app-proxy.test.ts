import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  APP_PROXY_BASE_PATH,
  APP_PROXY_PREFIX,
  APP_PROXY_SUBPATH,
  appProxySignatureIsValid,
  CUSTOMER_PORTAL_PATH,
  customerPortalLinks,
  customerPortalRelativeLinks,
} from "./app-proxy";

const SECRET = "shpss_test_secret";

/** Signs query parameters the way Shopify signs app proxy requests. */
function sign(params: Record<string, string | string[]>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      search.append(key, entry);
    }
  }
  const message = Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      return `${key}=${Array.isArray(value) ? value.join(",") : value}`;
    })
    .join("");
  search.set(
    "signature",
    createHmac("sha256", SECRET).update(message, "utf8").digest("hex"),
  );
  return search;
}

describe("app proxy signature verification", () => {
  it("accepts a correctly signed request", () => {
    const search = sign({
      shop: "unsolicited-plant-talks.myshopify.com",
      path_prefix: APP_PROXY_BASE_PATH,
      timestamp: "1780000000",
      logged_in_customer_id: "7654321",
    });
    assert.equal(appProxySignatureIsValid(search, SECRET), true);
  });

  it("accepts repeated parameters joined with a comma", () => {
    const search = sign({ shop: "s.myshopify.com", ids: ["1", "2", "3"] });
    assert.equal(appProxySignatureIsValid(search, SECRET), true);
  });

  it("rejects a request with no signature", () => {
    const search = new URLSearchParams({
      shop: "s.myshopify.com",
      logged_in_customer_id: "7654321",
    });
    assert.equal(appProxySignatureIsValid(search, SECRET), false);
  });

  it("rejects a spoofed customer id appended to a signed request", () => {
    const search = sign({ shop: "s.myshopify.com", timestamp: "1780000000" });
    search.set("logged_in_customer_id", "7654321");
    assert.equal(appProxySignatureIsValid(search, SECRET), false);
  });

  it("rejects a signature produced with a different secret", () => {
    const search = sign({ shop: "s.myshopify.com" });
    assert.equal(appProxySignatureIsValid(search, "other-secret"), false);
  });

  it("rejects a truncated signature", () => {
    const search = sign({ shop: "s.myshopify.com" });
    search.set("signature", search.get("signature")!.slice(0, 32));
    assert.equal(appProxySignatureIsValid(search, SECRET), false);
  });

  it("rejects verification when no secret is configured", () => {
    const search = sign({ shop: "s.myshopify.com" });
    assert.equal(appProxySignatureIsValid(search, ""), false);
  });
});

describe("customer portal links", () => {
  it("points at the storefront proxy path when served through the proxy", () => {
    const links = customerPortalLinks({
      shop: "unsolicited-plant-talks.myshopify.com",
      appUrl: "https://portal.example.com",
      viaAppProxy: true,
    });
    assert.equal(
      links.home,
      "https://unsolicited-plant-talks.myshopify.com/apps/plant-requests",
    );
    assert.equal(
      links.requestDetail("req_123"),
      "https://unsolicited-plant-talks.myshopify.com/apps/plant-requests/requests/req_123",
    );
  });

  it("points at the app origin for the local demo", () => {
    const links = customerPortalLinks({
      shop: "demo-shop.myshopify.com",
      appUrl: "http://localhost:3000/",
      viaAppProxy: false,
    });
    assert.equal(links.home, "http://localhost:3000/customer");
    assert.equal(
      links.requestDetail("req_123"),
      "http://localhost:3000/customer/requests/req_123",
    );
  });

  it("falls back to the app origin when the shop is unknown", () => {
    const links = customerPortalLinks({
      shop: null,
      appUrl: "https://portal.example.com",
      viaAppProxy: true,
    });
    assert.equal(links.home, "https://portal.example.com/customer");
  });

  it("keeps in-page links on the storefront under the proxy", () => {
    assert.equal(customerPortalRelativeLinks(true).home, APP_PROXY_BASE_PATH);
    assert.equal(
      customerPortalRelativeLinks(true).requestDetail("abc"),
      `${APP_PROXY_BASE_PATH}/requests/abc`,
    );
    assert.equal(customerPortalRelativeLinks(false).home, CUSTOMER_PORTAL_PATH);
  });
});

describe("app proxy configuration", () => {
  it("matches the [app_proxy] block in shopify.app.toml", () => {
    const toml = readFileSync(
      path.join(import.meta.dirname, "..", "..", "shopify.app.toml"),
      "utf8",
    );
    const block = toml.slice(toml.indexOf("[app_proxy]"));
    assert.equal(block.match(/^url\s*=\s*"([^"]*)"/m)?.[1], CUSTOMER_PORTAL_PATH);
    assert.equal(block.match(/^subpath\s*=\s*"([^"]*)"/m)?.[1], APP_PROXY_SUBPATH);
    assert.equal(block.match(/^prefix\s*=\s*"([^"]*)"/m)?.[1], APP_PROXY_PREFIX);
  });
});
