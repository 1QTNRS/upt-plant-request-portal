import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { offlineAdminClient } from "./offline-admin.server";
import { DEMO_SHOP } from "./shop";

describe("offline Admin client", () => {
  it("does not boot Shopify when the app URL is unset", async () => {
    const previous = process.env.SHOPIFY_APP_URL;
    delete process.env.SHOPIFY_APP_URL;
    try {
      assert.equal(await offlineAdminClient(`${DEMO_SHOP}-offline-admin`), undefined);
    } finally {
      if (previous === undefined) delete process.env.SHOPIFY_APP_URL;
      else process.env.SHOPIFY_APP_URL = previous;
    }
  });
});
