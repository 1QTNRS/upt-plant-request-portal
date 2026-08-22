import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APP_PROXY_ORIGIN_HEADER,
  CUSTOMER_PORTAL_PATH,
  originHost,
  storefrontOriginIsAllowed,
} from "./app-proxy";
import {
  APP_PROXY_ORIGIN_HEADER as SERVER_HEADER,
  APP_PROXY_TARGET_PATH,
  withholdAppProxyOrigin,
} from "../../server.js";

const SIGNED = "?shop=upt.myshopify.com&timestamp=1780000000&signature=abc123";

type FakeRequest = { method: string; url: string; headers: Record<string, string> };

function request(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): FakeRequest {
  return { method, url, headers };
}

describe("app proxy origin handoff", () => {
  it("uses the same header and path as the app", () => {
    assert.equal(SERVER_HEADER, APP_PROXY_ORIGIN_HEADER);
    assert.equal(APP_PROXY_TARGET_PATH, CUSTOMER_PORTAL_PATH);
  });

  it("withholds the storefront origin from a signed proxy submission", () => {
    const req = request("POST", `/customer/submit${SIGNED}`, {
      origin: "https://upt.myshopify.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers[APP_PROXY_ORIGIN_HEADER], "https://upt.myshopify.com");
  });

  it("covers the offer response route and single-fetch data requests", () => {
    for (const url of [
      `/customer/requests/req_1${SIGNED}`,
      `/customer.data${SIGNED}`,
      `/customer${SIGNED}`,
    ]) {
      const req = request("POST", url, { origin: "https://upt.myshopify.com" });
      withholdAppProxyOrigin(req);
      assert.equal(req.headers.origin, undefined, url);
    }
  });

  it("leaves the admin routes' cross-origin protection alone", () => {
    const req = request("POST", `/app/requests/req_1${SIGNED}`, {
      origin: "https://evil.example.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(req.headers.origin, "https://evil.example.com");
    assert.equal(req.headers[APP_PROXY_ORIGIN_HEADER], undefined);
  });

  it("leaves an unsigned request to the portal alone", () => {
    const req = request("POST", "/customer/submit", {
      origin: "https://evil.example.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(req.headers.origin, "https://evil.example.com");
  });

  it("leaves reads alone, since only actions are checked", () => {
    const req = request("GET", `/customer${SIGNED}`, {
      origin: "https://upt.myshopify.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(req.headers.origin, "https://upt.myshopify.com");
    assert.equal(req.headers[APP_PROXY_ORIGIN_HEADER], undefined);
  });

  it("drops a client-supplied copy of the internal header", () => {
    const req = request("GET", "/customer", {
      [APP_PROXY_ORIGIN_HEADER]: "https://upt.myshopify.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(req.headers[APP_PROXY_ORIGIN_HEADER], undefined);
  });

  it("does not let a caller choose the origin the app will vet", () => {
    const req = request("POST", `/customer/submit${SIGNED}`, {
      origin: "https://evil.example.com",
      [APP_PROXY_ORIGIN_HEADER]: "https://upt.myshopify.com",
    });
    withholdAppProxyOrigin(req);

    assert.equal(
      req.headers[APP_PROXY_ORIGIN_HEADER],
      "https://evil.example.com",
    );
  });
});

describe("storefront origin verification", () => {
  const hosts = ["upt.myshopify.com", "unsolicitedplanttalks.com"];

  it("accepts the shop's own domain", () => {
    assert.equal(
      storefrontOriginIsAllowed("https://upt.myshopify.com", hosts),
      true,
    );
  });

  it("accepts the shop's primary custom domain", () => {
    assert.equal(
      storefrontOriginIsAllowed("https://unsolicitedplanttalks.com", hosts),
      true,
    );
  });

  it("ignores case and a port", () => {
    assert.equal(
      storefrontOriginIsAllowed("https://UPT.MyShopify.com", hosts),
      true,
    );
    assert.equal(
      storefrontOriginIsAllowed("http://upt.myshopify.com:443", hosts),
      true,
    );
  });

  it("rejects another storefront proxying a forged submission", () => {
    assert.equal(
      storefrontOriginIsAllowed("https://attacker.myshopify.com", hosts),
      false,
    );
  });

  it("rejects a lookalike subdomain or suffix", () => {
    assert.equal(
      storefrontOriginIsAllowed("https://evil.upt.myshopify.com", hosts),
      false,
    );
    assert.equal(
      storefrontOriginIsAllowed("https://upt.myshopify.com.evil.test", hosts),
      false,
    );
  });

  it("rejects a missing, opaque or unparseable origin", () => {
    assert.equal(storefrontOriginIsAllowed(null, hosts), false);
    assert.equal(storefrontOriginIsAllowed("null", hosts), false);
    assert.equal(storefrontOriginIsAllowed("not a url", hosts), false);
  });

  it("rejects everything when the shop has no known hosts", () => {
    assert.equal(storefrontOriginIsAllowed("https://upt.myshopify.com", []), false);
  });

  it("reads the hostname without the scheme or port", () => {
    assert.equal(originHost("https://upt.myshopify.com:8443"), "upt.myshopify.com");
    assert.equal(originHost(undefined), null);
  });
});
