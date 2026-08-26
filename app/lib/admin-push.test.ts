import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PUSH_KIND_ITEM_STATUS,
  PUSH_KIND_NEW_REQUEST,
  adminPushIdempotencyKey,
  expoPushTokenHint,
  iosAdminRequestUrl,
  isExpoPushToken,
  itemStatusPushCopy,
  newRequestPushCopy,
  requestIdFromAdminPushData,
  resolveAdminPushDeepLink,
} from "./admin-push";

describe("iOS admin push copy", () => {
  it("keeps the new-request wording concise", () => {
    assert.deepEqual(
      newRequestPushCopy({ requestNumber: "REQ1234", customerName: "April Mall" }),
      { title: "New plant request", body: "REQ1234 from April Mall" },
    );
  });

  it("consolidates Accept/Reject counts into one line", () => {
    assert.deepEqual(
      itemStatusPushCopy({ requestNumber: "REQ1234", acceptedCount: 2, rejectedCount: 0 }),
      { title: "Item status update", body: "REQ1234: 2 accepted" },
    );
    assert.deepEqual(
      itemStatusPushCopy({ requestNumber: "REQ1234", acceptedCount: 0, rejectedCount: 3 }),
      { title: "Item status update", body: "REQ1234: 3 rejected" },
    );
    assert.deepEqual(
      itemStatusPushCopy({ requestNumber: "REQ1234", acceptedCount: 2, rejectedCount: 3 }),
      { title: "Item status update", body: "REQ1234: 2 accepted, 3 rejected" },
    );
    assert.deepEqual(
      itemStatusPushCopy({ requestNumber: "REQ1234", acceptedCount: 1, rejectedCount: 1 }),
      { title: "Item status update", body: "REQ1234: 1 accepted, 1 rejected" },
    );
    assert.equal(
      itemStatusPushCopy({ requestNumber: "REQ1", acceptedCount: 0, rejectedCount: 0 }),
      null,
    );
  });

  it("validates Expo tokens without logging the full value", () => {
    assert.equal(isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]"), true);
    assert.equal(isExpoPushToken("not-a-token"), false);
    assert.equal(
      expoPushTokenHint("ExponentPushToken[abcdefghijklmnopqrstuv]").includes("abcdefghijklmnopqrstuv"),
      false,
    );
    assert.equal(adminPushIdempotencyKey(PUSH_KIND_NEW_REQUEST, "req-1"), "new_request:req-1");
    assert.equal(adminPushIdempotencyKey(PUSH_KIND_ITEM_STATUS, "req-1"), "item_status:req-1");
  });

  it("requires a signed-in session before opening a request", () => {
    assert.equal(iosAdminRequestUrl("req-1"), "uptadmin://request/req-1");
    assert.equal(requestIdFromAdminPushData({ requestId: "req-1" }), "req-1");
    assert.deepEqual(resolveAdminPushDeepLink({ signedIn: false, requestId: "req-1" }), {
      openRequestId: null,
      pendingRequestId: "req-1",
    });
    assert.deepEqual(resolveAdminPushDeepLink({ signedIn: true, requestId: "req-1" }), {
      openRequestId: "req-1",
      pendingRequestId: null,
    });
  });
});
