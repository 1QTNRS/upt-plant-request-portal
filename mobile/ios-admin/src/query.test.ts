import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiPath } from "./query";

describe("apiPath", () => {
  it("includes status even when URLSearchParams.size is missing", () => {
    const original = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    Object.defineProperty(URLSearchParams.prototype, "size", {
      configurable: true,
      get() {
        return undefined;
      },
    });
    try {
      assert.equal(
        apiPath("/api/mobile/admin/requests", { status: "Pending", q: "" }),
        "/api/mobile/admin/requests?status=Pending",
      );
      assert.equal(apiPath("/api/mobile/admin/requests", {}), "/api/mobile/admin/requests");
    } finally {
      if (original) Object.defineProperty(URLSearchParams.prototype, "size", original);
      else delete (URLSearchParams.prototype as { size?: unknown }).size;
    }
  });
});
