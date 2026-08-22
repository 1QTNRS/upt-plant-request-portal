import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import prisma from "../db.server";
import {
  disabledPlantIdentityProvider,
  type PlantIdentityProvider,
} from "./plant-identity-ai.server";
import {
  backfillCanonicalPlants,
  confirmPlantIdentitySuggestion,
  listPlantIdentitySuggestions,
  rejectPlantIdentitySuggestion,
  resolvePlantIdentity,
} from "./plant-identity.server";
import { DEMO_SHOP } from "./shop";

const shop = `${DEMO_SHOP}-plant-identity-test`;

async function reset() {
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.plantIdentitySuggestion.deleteMany({ where: { shop } });
  await prisma.plantNameAlias.deleteMany({ where: { shop } });
  await prisma.canonicalPlant.deleteMany({ where: { shop } });
}

/** No provider configured, which is the default and what CI runs. */
const noAi = { provider: disabledPlantIdentityProvider };

let nextRequestNumber = 1;

async function seedItems(names: string[], submittedAt = new Date("2026-01-10T00:00:00.000Z")) {
  const customer = await prisma.customerProfile.upsert({
    where: { shop_email: { shop, email: "identity@example.com" } },
    create: { shop, name: "Identity Customer", email: "identity@example.com" },
    update: {},
  });

  return prisma.plantRequest.create({
    data: {
      shop,
      requestNumber: `REQ${nextRequestNumber++}`,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      status: "New",
      submittedAt,
      items: {
        create: names.map((plantName) => ({
          plantName,
          offeredName: plantName,
          quantity: 1,
        })),
      },
    },
    include: { items: true },
  });
}

describe("plant identity resolution", () => {
  before(reset);
  after(reset);

  it("files formatting variants under one identity", async () => {
    await reset();
    const first = await resolvePlantIdentity(shop, "Hoya carnosa", noAi);
    for (const variant of ["hoya  carnosa", "HOYA CARNOSA", "Hoya sp. carnosa"]) {
      const resolved = await resolvePlantIdentity(shop, variant, noAi);
      assert.equal(resolved.canonicalPlantId, first.canonicalPlantId, variant);
      assert.equal(resolved.confidence, "high");
    }
  });

  it("files an abbreviated genus under the species already known", async () => {
    await reset();
    const first = await resolvePlantIdentity(shop, "Hoya carnosa", noAi);
    const abbreviated = await resolvePlantIdentity(shop, "H. carnosa", noAi);
    assert.equal(abbreviated.canonicalPlantId, first.canonicalPlantId);
    assert.equal(abbreviated.confidence, "high");
  });

  it("groups a single mistyped character without asking", async () => {
    await reset();
    const first = await resolvePlantIdentity(shop, "Hoya carnosa", noAi);
    for (const typo of ["Hoya carnsa", "Hoya carnoosa"]) {
      const resolved = await resolvePlantIdentity(shop, typo, noAi);
      assert.equal(resolved.canonicalPlantId, first.canonicalPlantId, typo);
      assert.equal(resolved.confidence, "high");
      assert.equal(resolved.suggestionId, undefined);
    }
    assert.equal(await prisma.plantIdentitySuggestion.count({ where: { shop } }), 0);
  });

  it("keeps the first spelling the shop saw as the identity's name", async () => {
    await reset();
    await resolvePlantIdentity(shop, "Hoya carnosa", noAi);
    const typo = await resolvePlantIdentity(shop, "Hoya carnsa", noAi);
    assert.equal(typo.displayName, "Hoya carnosa");
  });

  it("asks rather than merges at medium confidence", async () => {
    await reset();
    const known = await resolvePlantIdentity(shop, "Hoya callistophylla", noAi);
    const doubtful = await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);

    assert.equal(doubtful.confidence, "medium");
    assert.notEqual(
      doubtful.canonicalPlantId,
      known.canonicalPlantId,
      "a medium-confidence match must not be merged",
    );

    const suggestions = await listPlantIdentitySuggestions(shop);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].originalName, "Hoya calistophyla");
    assert.equal(suggestions[0].suggestedDisplayName, "Hoya callistophylla");
    assert.equal(suggestions[0].source, "deterministic");
  });

  it("keeps low-confidence names apart silently", async () => {
    await reset();
    const first = await resolvePlantIdentity(shop, "Hoya carnosa", noAi);
    const other = await resolvePlantIdentity(shop, "Monstera deliciosa", noAi);
    assert.notEqual(other.canonicalPlantId, first.canonicalPlantId);
    assert.equal(other.confidence, "low");
    assert.equal(await prisma.plantIdentitySuggestion.count({ where: { shop } }), 0);
  });

  it("does not merge accession, cultivar, clone or locality differences", async () => {
    await reset();
    const pairs: Array<[string, string]> = [
      ["Hoya sp. AH-021", "Hoya sp. AH-022"],
      ["Hoya carnosa 'Krimson Queen'", "Hoya carnosa 'Krimson Princess'"],
      ["Hoya carnosa clone 3", "Hoya carnosa clone 4"],
      ["Hoya sp. ex Borneo", "Hoya sp. ex Sulawesi"],
      ["Anthurium seedling 7", "Anthurium seedling 8"],
      ["Hoya carnosa 'Krimson Queen'", "Hoya carnosa"],
    ];

    for (const [left, right] of pairs) {
      await reset();
      const a = await resolvePlantIdentity(shop, left, noAi);
      const b = await resolvePlantIdentity(shop, right, noAi);
      assert.notEqual(
        a.canonicalPlantId,
        b.canonicalPlantId,
        `${left} and ${right} must stay separate`,
      );
      assert.notEqual(b.confidence, "high");
    }
  });

  it("reuses a confirmed alias for good, without a second suggestion", async () => {
    await reset();
    const known = await resolvePlantIdentity(shop, "Hoya callistophylla", noAi);
    await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);
    const [suggestion] = await listPlantIdentitySuggestions(shop);

    const result = await confirmPlantIdentitySuggestion(shop, suggestion.id);
    assert.equal(result.ok, true);

    const again = await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);
    assert.equal(again.canonicalPlantId, known.canonicalPlantId);
    assert.equal(again.confidence, "high");
    assert.equal(again.suggestionId, undefined);

    // The identity the spelling used to have is gone rather than left orphaned.
    assert.equal(await prisma.canonicalPlant.count({ where: { shop } }), 1);
    assert.deepEqual(await listPlantIdentitySuggestions(shop), []);
  });

  it("moves the request lines of a confirmed merge onto the surviving identity", async () => {
    await reset();
    const request = await seedItems(["Hoya callistophylla", "Hoya calistophyla"]);
    await backfillCanonicalPlants(shop, noAi);

    const [suggestion] = await listPlantIdentitySuggestions(shop);
    assert.ok(suggestion, "the near-miss spelling should be queued for review");
    assert.equal(suggestion.affectedItems, 1);

    await confirmPlantIdentitySuggestion(shop, suggestion.id);

    const items = await prisma.requestItem.findMany({
      where: { requestId: request.id },
      select: { plantName: true, canonicalPlantId: true },
    });
    assert.equal(new Set(items.map((item) => item.canonicalPlantId)).size, 1);
    // The customer's own wording is untouched by the merge.
    assert.deepEqual(
      items.map((item) => item.plantName).sort(),
      ["Hoya calistophyla", "Hoya callistophylla"],
    );
  });

  it("never proposes a pair the admin answered Keep Separate", async () => {
    await reset();
    await resolvePlantIdentity(shop, "Hoya callistophylla", noAi);
    const separate = await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);
    const [suggestion] = await listPlantIdentitySuggestions(shop);

    assert.equal((await rejectPlantIdentitySuggestion(shop, suggestion.id)).ok, true);
    assert.deepEqual(await listPlantIdentitySuggestions(shop), []);

    const again = await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);
    assert.equal(again.canonicalPlantId, separate.canonicalPlantId);
    assert.deepEqual(await listPlantIdentitySuggestions(shop), []);

    // Even with the recorded mapping gone, the answer stands: the rejected pair
    // is remembered on the suggestion, not on the alias that happened to exist
    // when it was answered.
    await prisma.plantNameAlias.deleteMany({
      where: { shop, aliasKey: "hoya calistophyla" },
    });
    const reresolved = await resolvePlantIdentity(shop, "Hoya calistophyla", noAi);
    assert.equal(reresolved.canonicalPlantId, separate.canonicalPlantId);
    assert.deepEqual(await listPlantIdentitySuggestions(shop), []);
  });
});

describe("AI assistance is only ever a suggestion", () => {
  before(reset);
  after(reset);

  it("queues a review instead of linking, however sure the provider claims to be", async () => {
    await reset();
    const known = await resolvePlantIdentity(shop, "Wax Plant", noAi);

    const confident: PlantIdentityProvider = {
      name: "test-provider",
      async suggestCanonicalPlant() {
        return {
          canonicalPlantId: known.canonicalPlantId,
          confidence: 1,
          reason: "Certain.",
        };
      },
    };

    const resolved = await resolvePlantIdentity(shop, "Hoya carnosa", {
      provider: confident,
    });
    assert.notEqual(
      resolved.canonicalPlantId,
      known.canonicalPlantId,
      "AI must never link a name to an identity on its own",
    );
    assert.equal(resolved.confidence, "medium");

    const suggestions = await listPlantIdentitySuggestions(shop);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].source, "test-provider");
  });

  it("ignores a provider naming an identity that does not exist", async () => {
    await reset();
    await resolvePlantIdentity(shop, "Wax Plant", noAi);

    const inventing: PlantIdentityProvider = {
      name: "test-provider",
      async suggestCanonicalPlant() {
        return { canonicalPlantId: "made-up", confidence: 1, reason: "Certain." };
      },
    };

    const resolved = await resolvePlantIdentity(shop, "Hoya carnosa", {
      provider: inventing,
    });
    assert.ok(resolved.canonicalPlantId);
    // The row could not be created, so nothing is queued against it either.
    assert.deepEqual(await listPlantIdentitySuggestions(shop), []);
  });

  it("resolves normally when the provider fails", async () => {
    await reset();
    await resolvePlantIdentity(shop, "Wax Plant", noAi);

    const broken: PlantIdentityProvider = {
      name: "test-provider",
      async suggestCanonicalPlant() {
        throw new Error("provider unreachable");
      },
    };

    const resolved = await resolvePlantIdentity(shop, "Hoya carnosa", {
      provider: broken,
    });
    assert.ok(resolved.canonicalPlantId);
    assert.equal(resolved.confidence, "low");
  });
});

describe("canonical plant backfill", () => {
  before(reset);
  after(reset);

  it("claims rows that only ever had the customer's text", async () => {
    await reset();
    const request = await seedItems(["Hoya carnosa", "H. carnosa", "hoya  carnosa"]);
    assert.equal(
      await prisma.requestItem.count({
        where: { requestId: request.id, canonicalPlantId: null },
      }),
      3,
      "seeded rows start with no identity",
    );

    const resolved = await backfillCanonicalPlants(shop, noAi);
    assert.equal(resolved, 3);

    const items = await prisma.requestItem.findMany({
      where: { requestId: request.id },
      select: { plantName: true, canonicalPlantId: true },
    });
    assert.equal(
      new Set(items.map((item) => item.canonicalPlantId)).size,
      1,
      "all three spellings land on one identity",
    );
    assert.deepEqual(
      items.map((item) => item.plantName).sort(),
      ["H. carnosa", "Hoya carnosa", "hoya  carnosa"],
      "the customer's wording is preserved exactly",
    );
  });

  it("is safe to re-run", async () => {
    await reset();
    await seedItems(["Hoya carnosa", "Monstera deliciosa"]);
    assert.equal(await backfillCanonicalPlants(shop, noAi), 2);
    assert.equal(await backfillCanonicalPlants(shop, noAi), 0);
    assert.equal(await backfillCanonicalPlants(shop, noAi), 0);
    assert.equal(await prisma.canonicalPlant.count({ where: { shop } }), 2);
    assert.equal(await prisma.plantNameAlias.count({ where: { shop } }), 2);
  });

  it("gives the identity the wording of the oldest request that used it", async () => {
    await reset();
    await seedItems(["Hoya carnosa"], new Date("2026-01-01T00:00:00.000Z"));
    await seedItems(["hoya CARNOSA"], new Date("2025-06-01T00:00:00.000Z"));

    await backfillCanonicalPlants(shop, noAi);
    const canonical = await prisma.canonicalPlant.findMany({ where: { shop } });
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].displayName, "hoya CARNOSA");
  });

  it("resolves a new request as it is submitted", async () => {
    await reset();
    const { submitCustomerRequest } = await import("./portal.server");
    const created = await submitCustomerRequest(shop, {
      name: "Identity Customer",
      email: "identity@example.com",
      items: [{ plantName: "Hoya carnosa" }, { plantName: "H. carnosa" }],
    });

    const items = await prisma.requestItem.findMany({
      where: { request: { id: created.id } },
      select: { canonicalPlantId: true },
    });
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.canonicalPlantId));
    assert.equal(new Set(items.map((item) => item.canonicalPlantId)).size, 1);
  });
});
