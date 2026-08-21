import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APP_PROXY_BASE_PATH, CUSTOMER_PORTAL_PATH } from "./app-proxy";
import {
  portalFormAction,
  portalHome,
  readPlantLines,
  withExtraRow,
  withoutRow,
} from "./customer-portal";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

function context(viaAppProxy: boolean) {
  return { viaAppProxy };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("customer portal form target", () => {
  it("posts to the storefront proxy path when served through the proxy", () => {
    assert.equal(portalFormAction(context(true)), `${APP_PROXY_BASE_PATH}/submit`);
  });

  it("posts to the app path for the local demo", () => {
    assert.equal(portalFormAction(context(false)), `${CUSTOMER_PORTAL_PATH}/submit`);
  });

  /**
   * React Router removes `index` from the request URL before a loader sees it,
   * so Shopify signs a query string containing `index` that the app then
   * verifies without it. Every proxied submission fails its HMAC check and the
   * customer is shown the signed-out page.
   */
  it("never uses React Router's ?index convention", () => {
    for (const viaAppProxy of [true, false]) {
      assert.ok(
        !portalFormAction(context(viaAppProxy)).includes("index"),
        "the app proxy signature cannot survive an ?index form action",
      );
    }
  });

  it("keeps the customer on the storefront after submitting", () => {
    assert.equal(portalHome(context(true)), APP_PROXY_BASE_PATH);
    assert.ok(!portalHome(context(true)).startsWith(CUSTOMER_PORTAL_PATH));
  });
});

describe("plant rows", () => {
  it("reads a single row", () => {
    assert.deepEqual(
      readPlantLines(form({ itemCount: "1", "plantName-0": "Hoya", "notes-0": "" })),
      [{ plantName: "Hoya", notes: "" }],
    );
  });

  it("reads several rows and keeps their notes", () => {
    const lines = readPlantLines(
      form({
        itemCount: "2",
        "plantName-0": "Monstera",
        "notes-0": "variegated",
        "plantName-1": "Philodendron",
        "notes-1": "",
      }),
    );
    assert.deepEqual(lines, [
      { plantName: "Monstera", notes: "variegated" },
      { plantName: "Philodendron", notes: "" },
    ]);
  });

  it("always yields at least one row", () => {
    assert.equal(readPlantLines(form({})).length, 1);
    assert.equal(readPlantLines(form({ itemCount: "0" })).length, 1);
    assert.equal(readPlantLines(form({ itemCount: "-3" })).length, 1);
  });

  it("caps the row count a submitted form can ask for", () => {
    assert.equal(readPlantLines(form({ itemCount: "5000" })).length, 20);
  });

  it("adds a row without disturbing the typed ones", () => {
    const lines = [{ plantName: "Monstera", notes: "variegated" }];
    assert.deepEqual(withExtraRow(lines), [
      { plantName: "Monstera", notes: "variegated" },
      { plantName: "", notes: "" },
    ]);
  });

  it("stops adding rows at the cap", () => {
    const many = Array.from({ length: 20 }, () => ({ plantName: "x", notes: "" }));
    assert.equal(withExtraRow(many).length, 20);
  });

  it("removes the row that was clicked and keeps the rest", () => {
    const lines = [
      { plantName: "A", notes: "1" },
      { plantName: "B", notes: "2" },
      { plantName: "C", notes: "3" },
    ];
    assert.deepEqual(withoutRow(lines, 1), [
      { plantName: "A", notes: "1" },
      { plantName: "C", notes: "3" },
    ]);
  });

  it("never removes the last row", () => {
    assert.deepEqual(withoutRow([{ plantName: "A", notes: "" }], 0), [
      { plantName: "", notes: "" },
    ]);
  });
});

describe("the request form works without JavaScript", () => {
  // An app proxy page serves its assets from the shop's domain, so it never
  // hydrates. Anything that depends on React state is dead on the storefront.
  const source = readFileSync(
    path.join(REPO_ROOT, "app", "components", "customer-request-portal.tsx"),
    "utf8",
  );

  it("submits real named fields rather than React-controlled mirrors", () => {
    assert.match(source, /name=\{`plantName-\$\{index\}`\}/);
    assert.match(source, /name=\{`notes-\$\{index\}`\}/);
    assert.match(source, /defaultValue=\{line\.plantName\}/);
  });

  it("adds and removes rows with submit buttons, not onClick handlers", () => {
    assert.ok(!source.includes("onClick"), "onClick does nothing without hydration");
    assert.match(source, /value="add-plant"/);
    assert.match(source, /value=\{`remove-plant-\$\{index\}`\}/);
  });

  it("uses a plain form, not the client router's Form", () => {
    // React Router's <Form> submits through the client router, which only knows
    // the app's own paths and would post to the shop domain's /customer.
    assert.ok(!/<Form\b/.test(source));
    assert.match(source, /<form method="post" action=\{formAction\}>/);
  });

  it("holds no client state for the plant rows", () => {
    assert.ok(!source.includes("useState"));
    assert.ok(!source.includes("useEffect"));
  });
});
