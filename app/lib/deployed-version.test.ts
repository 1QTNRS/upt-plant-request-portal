import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeployedVersion,
  commitMatchesExpected,
  deployedCommitFromEnv,
} from "./deployed-version";

describe("deployed version", () => {
  it("reads the Render commit and ignores empties", () => {
    assert.equal(
      deployedCommitFromEnv({ RENDER_GIT_COMMIT: "abc123def" }),
      "abc123def",
    );
    assert.equal(deployedCommitFromEnv({ RENDER_GIT_COMMIT: "unknown" }), null);
    assert.equal(deployedCommitFromEnv({}), null);
  });

  it("never includes env keys or secrets in the payload", () => {
    const payload = buildDeployedVersion({
      healthy: true,
      commit: "abc123",
    });
    assert.deepEqual(Object.keys(payload).sort(), [
      "commit",
      "migrations",
      "status",
    ]);
    assert.equal(JSON.stringify(payload).includes("SHOPIFY"), false);
  });

  it("matches full SHAs and prefixes", () => {
    assert.equal(commitMatchesExpected("abc123def", "abc123def"), true);
    assert.equal(commitMatchesExpected("abc123def", "abc123"), true);
    assert.equal(commitMatchesExpected("fff", "abc"), false);
    assert.equal(commitMatchesExpected(null, "abc"), false);
  });
});
