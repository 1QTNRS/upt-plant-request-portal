import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { localUploadsAllowed } from "./uploads.server";

describe("local upload fallback policy", () => {
  function withNodeEnv(value: string | undefined, run: () => void) {
    const original = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    try {
      run();
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  }

  it("is refused in production", () => {
    // A photo written to the container disk vanishes on the next deploy, and the
    // offer snapshot it was frozen into would point at a dead URL.
    withNodeEnv("production", () => {
      assert.equal(localUploadsAllowed(), false);
    });
  });

  it("is allowed in development", () => {
    withNodeEnv("development", () => {
      assert.equal(localUploadsAllowed(), true);
    });
  });

  it("is allowed when NODE_ENV is unset", () => {
    withNodeEnv(undefined, () => {
      assert.equal(localUploadsAllowed(), true);
    });
  });
});
