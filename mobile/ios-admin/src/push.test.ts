import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  iosAdminRequestUrlForVariant,
  iosAdminSchemeFromConfig,
} from "./app-identity";
import {
  requestIdFromAdminPushData,
  resolveAdminPushDeepLink,
} from "./push-deep-link";

describe("iOS admin push deep links", () => {
  it("uses the production scheme by default", () => {
    assert.equal(iosAdminSchemeFromConfig({}), "uptadmin");
    assert.equal(
      iosAdminRequestUrlForVariant("production", "req-9"),
      "uptadmin://request/req-9",
    );
  });

  it("uses the development scheme when the dev variant is selected", () => {
    assert.equal(
      iosAdminSchemeFromConfig({ appVariant: "development" }),
      "uptadmin-dev",
    );
    assert.equal(
      iosAdminRequestUrlForVariant("development", "req-9"),
      "uptadmin-dev://request/req-9",
    );
  });

  it("routes a notification to the request only after sign-in", () => {
    assert.equal(
      requestIdFromAdminPushData({ requestId: "req-9", kind: "new_request" }),
      "req-9",
    );
    assert.deepEqual(resolveAdminPushDeepLink({ signedIn: false, requestId: "req-9" }), {
      openRequestId: null,
      pendingRequestId: "req-9",
    });
    assert.deepEqual(resolveAdminPushDeepLink({ signedIn: true, requestId: "req-9" }), {
      openRequestId: "req-9",
      pendingRequestId: null,
    });
  });
});
