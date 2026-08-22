import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  disabledPlantIdentityProvider,
  plantIdentityAiStatus,
  plantIdentityProviderFromEnv,
  readPlantIdentityAiConfig,
} from "./plant-identity-ai.server";

const fullConfig = {
  PLANT_IDENTITY_AI_PROVIDER: "openai",
  PLANT_IDENTITY_AI_BASE_URL: "https://api.example.test/v1/",
  PLANT_IDENTITY_AI_MODEL: "some-model",
  PLANT_IDENTITY_AI_API_KEY: "not-a-real-key",
} as NodeJS.ProcessEnv;

describe("plant identity AI configuration", () => {
  it("is off with an empty environment, which is the default", () => {
    assert.equal(readPlantIdentityAiConfig({}), null);
    assert.equal(plantIdentityProviderFromEnv({}), disabledPlantIdentityProvider);
    assert.equal(plantIdentityAiStatus({}).enabled, false);
  });

  it("stays off until every variable is present", () => {
    for (const omitted of Object.keys(fullConfig)) {
      const env = { ...fullConfig };
      delete env[omitted];
      assert.equal(
        readPlantIdentityAiConfig(env),
        null,
        `${omitted} missing must leave AI disabled`,
      );
    }
  });

  it("takes the vendor from configuration rather than hard-coding one", () => {
    const config = readPlantIdentityAiConfig(fullConfig);
    assert.equal(config?.provider, "openai");
    assert.equal(config?.model, "some-model");
    // Trailing slash trimmed so the request path is built once, correctly.
    assert.equal(config?.baseUrl, "https://api.example.test/v1");

    const other = readPlantIdentityAiConfig({
      ...fullConfig,
      PLANT_IDENTITY_AI_PROVIDER: "anthropic",
      PLANT_IDENTITY_AI_MODEL: "another-model",
      PLANT_IDENTITY_AI_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    assert.equal(other?.provider, "anthropic");
    assert.equal(other?.baseUrl, "http://127.0.0.1:11434/v1");
  });

  it("names the variables an owner has to set", () => {
    const detail = plantIdentityAiStatus({}).detail;
    for (const variable of Object.keys(fullConfig)) {
      assert.ok(detail.includes(variable), `${variable} should be named`);
    }
  });

  it("reports which provider and model are in use once configured", () => {
    const status = plantIdentityAiStatus(fullConfig);
    assert.equal(status.enabled, true);
    assert.equal(status.provider, "openai");
    assert.equal(status.model, "some-model");
    assert.ok(!status.detail.includes("not-a-real-key"), "never echo the key");
  });

  it("suggests nothing when disabled", async () => {
    const result = await disabledPlantIdentityProvider.suggestCanonicalPlant(
      "Hoya carnosa",
      [{ canonicalPlantId: "a", displayName: "Hoya carnosa", aliases: [] }],
    );
    assert.equal(result, null);
  });
});
