import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  iosAdminRequestUrl,
  requestIdFromAdminPushData,
  resolveAdminPushDeepLink,
} from "./push";

describe("iOS admin push deep links", () => {
  it("routes a notification to the request only after sign-in", () => {
    assert.equal(iosAdminRequestUrl("req-9"), "uptadmin://request/req-9");
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
