import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APPROVED_SMOKE_SHOP,
  assertApprovedSmokeShop,
  classifyPullRequestRisk,
} from "./pr-risk";

describe("PR risk classification", () => {
  it("treats UI and test-only diffs as routine", () => {
    const result = classifyPullRequestRisk({
      title: "Sort the EXACT PLANTS table",
      files: [
        "app/components/exact-plants-table.tsx",
        "app/lib/exact-plants.ts",
        "app/lib/exact-plants.test.ts",
      ],
    });
    assert.equal(result.risk, "routine");
  });

  it("treats auth, webhooks, schema, and Render changes as high-risk", () => {
    assert.equal(
      classifyPullRequestRisk({ files: ["app/lib/admin-auth.server.ts"] }).risk,
      "high-risk",
    );
    assert.equal(
      classifyPullRequestRisk({ files: ["app/routes/webhooks.orders.paid.tsx"] }).risk,
      "high-risk",
    );
    assert.equal(
      classifyPullRequestRisk({ files: ["app/routes/events.acknowledge.tsx"] }).risk,
      "high-risk",
    );
    assert.equal(
      classifyPullRequestRisk({ files: ["prisma/schema.prisma"] }).risk,
      "high-risk",
    );
    assert.equal(
      classifyPullRequestRisk({ files: ["render.yaml"] }).risk,
      "high-risk",
    );
    assert.equal(
      classifyPullRequestRisk({ files: [".github/workflows/auto-merge.yml"] }).risk,
      "high-risk",
    );
    assert.equal(classifyPullRequestRisk({ files: [] }).risk, "high-risk");
  });

  it("lets an explicit high-risk label win, and treats uncertainty as high-risk", () => {
    assert.equal(
      classifyPullRequestRisk({
        labels: ["high-risk"],
        files: ["app/lib/exact-plants.ts"],
      }).risk,
      "high-risk",
    );
  });
});

describe("smoke shop guard", () => {
  it("accepts only the approved dev store", () => {
    assert.doesNotThrow(() => assertApprovedSmokeShop(APPROVED_SMOKE_SHOP));
    assert.throws(() => assertApprovedSmokeShop("demo-shop.myshopify.com"));
    assert.throws(() =>
      assertApprovedSmokeShop("unsolicited-plant-talks.myshopify.com"),
    );
  });
});
