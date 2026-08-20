import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { identityOwnsRequest } from "./customer-identity";

describe("customer request ownership", () => {
  it("matches on the Shopify customer id", () => {
    assert.equal(
      identityOwnsRequest(
        { email: "a@example.com", shopifyCustomerId: "1001" },
        { email: "a@example.com", shopifyCustomerId: "1001" },
      ),
      true,
    );
  });

  it("refuses a different Shopify customer even when the email matches", () => {
    // A shared or recycled email address must not expose another shopper's
    // request.
    assert.equal(
      identityOwnsRequest(
        { email: "shared@example.com", shopifyCustomerId: "1001" },
        { email: "shared@example.com", shopifyCustomerId: "2002" },
      ),
      false,
    );
  });

  it("refuses a claimed request when the visitor has no account id", () => {
    assert.equal(
      identityOwnsRequest(
        { email: "a@example.com" },
        { email: "a@example.com", shopifyCustomerId: "1001" },
      ),
      false,
    );
  });

  it("matches pre-account requests by email", () => {
    assert.equal(
      identityOwnsRequest(
        { email: "A@Example.com ", shopifyCustomerId: "1001" },
        { email: "a@example.com", shopifyCustomerId: null },
      ),
      true,
    );
  });

  it("refuses when the request is missing", () => {
    assert.equal(
      identityOwnsRequest({ email: "a@example.com", shopifyCustomerId: "1" }, null),
      false,
    );
  });

  it("refuses when neither side has a usable identifier", () => {
    // An unresolvable email must never act as a wildcard.
    assert.equal(identityOwnsRequest({ email: "" }, { email: "" }), false);
    assert.equal(
      identityOwnsRequest({ email: "" }, { email: "a@example.com" }),
      false,
    );
    assert.equal(
      identityOwnsRequest({ email: "a@example.com" }, { email: "" }),
      false,
    );
  });
});
