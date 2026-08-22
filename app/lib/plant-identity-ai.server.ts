/**
 * Optional AI assistance for canonical plant identity.
 *
 * The deterministic normaliser in `plant-identity.ts` is the whole of what this
 * app needs: requests, offers, payments and analytics all work with no provider
 * configured, which is the default and the only path CI takes. A provider can
 * only ever improve the *quality of a suggestion* an admin is about to read.
 *
 * Two rules it may never break:
 *
 * 1. It may only suggest. A provider's answer is capped at `medium` confidence,
 *    so it produces a row on the review queue and nothing else — it can never
 *    link a name to an identity on its own, and it is nowhere near inventory,
 *    holds or offers.
 * 2. Its absence, failure, timeout or nonsense reply must be indistinguishable
 *    from "no suggestion". Every call site treats a rejected promise as null.
 *
 * ## Enabling a provider
 *
 * All four variables are required together; with any of them missing the
 * disabled implementation is used and nothing is ever sent anywhere.
 *
 * | Variable | Meaning |
 * | --- | --- |
 * | `PLANT_IDENTITY_AI_PROVIDER` | Label for the vendor, e.g. `openai`, `anthropic`, `together`, `ollama`. Recorded on the suggestion so the owner can see where it came from |
 * | `PLANT_IDENTITY_AI_BASE_URL` | Base URL of an OpenAI-compatible chat-completions endpoint, e.g. `https://api.openai.com/v1`. Naming the URL rather than the vendor is what keeps this from being hard-coded to one company |
 * | `PLANT_IDENTITY_AI_MODEL` | Model id to send, e.g. `gpt-4o-mini`, `claude-sonnet-4-5`, `llama3.1:8b` |
 * | `PLANT_IDENTITY_AI_API_KEY` | Bearer token for that endpoint |
 *
 * Optional: `PLANT_IDENTITY_AI_TIMEOUT_MS` (default 5000). The call is on an
 * admin page load, so it is aborted rather than allowed to hold the page.
 */

import type { PlantMatchConfidence } from "./plant-identity";

export type CanonicalPlantCandidate = {
  canonicalPlantId: string;
  displayName: string;
  /** Spellings already mapped to this identity, which is the useful context. */
  aliases: string[];
};

export type PlantIdentitySuggestionResult = {
  canonicalPlantId: string;
  /** 0–1, as reported by the provider. Never used to reach `high`. */
  confidence: number;
  reason: string;
};

export interface PlantIdentityProvider {
  /** Recorded on any suggestion this provider produced. */
  readonly name: string;
  suggestCanonicalPlant(
    name: string,
    candidates: CanonicalPlantCandidate[],
  ): Promise<PlantIdentitySuggestionResult | null>;
}

/**
 * The default. Answers "no idea" to everything, which is exactly what the
 * deterministic path already assumed.
 */
export const disabledPlantIdentityProvider: PlantIdentityProvider = {
  name: "disabled",
  async suggestCanonicalPlant() {
    return null;
  },
};

/** An AI answer is never allowed past a suggestion. */
export const AI_MAX_CONFIDENCE: PlantMatchConfidence = "medium";

const DEFAULT_TIMEOUT_MS = 5000;

export type PlantIdentityAiConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export function readPlantIdentityAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlantIdentityAiConfig | null {
  const provider = env.PLANT_IDENTITY_AI_PROVIDER?.trim();
  const baseUrl = env.PLANT_IDENTITY_AI_BASE_URL?.trim();
  const model = env.PLANT_IDENTITY_AI_MODEL?.trim();
  const apiKey = env.PLANT_IDENTITY_AI_API_KEY?.trim();
  if (!provider || !baseUrl || !model || !apiKey) return null;

  const timeout = Number.parseInt(
    env.PLANT_IDENTITY_AI_TIMEOUT_MS?.trim() || "",
    10,
  );
  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    timeoutMs:
      Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export type PlantIdentityAiStatus = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  /** Shown to the admin so "no suggestions" is never a mystery. */
  detail: string;
};

export function plantIdentityAiStatus(
  env: NodeJS.ProcessEnv = process.env,
): PlantIdentityAiStatus {
  const config = readPlantIdentityAiConfig(env);
  if (!config) {
    return {
      enabled: false,
      provider: null,
      model: null,
      detail:
        "AI assistance is off. Name matching is running on the built-in rules, which need no credentials. Set PLANT_IDENTITY_AI_PROVIDER, PLANT_IDENTITY_AI_BASE_URL, PLANT_IDENTITY_AI_MODEL and PLANT_IDENTITY_AI_API_KEY to add AI suggestions.",
    };
  }
  return {
    enabled: true,
    provider: config.provider,
    model: config.model,
    detail: `AI suggestions come from ${config.provider} (${config.model}). They are only ever suggestions — nothing is merged without an admin answering Same Plant.`,
  };
}

const SYSTEM_PROMPT = [
  "You match a customer's plant name to one of the shop's existing plant identities.",
  "Answer with JSON only: {\"canonicalPlantId\": string | null, \"confidence\": number, \"reason\": string}.",
  "Use null when the name is not one of the candidates, or when it names a different cultivar, clone, accession, locality or collection number.",
  "Never match two names apart only by a number, a quoted cultivar or a place.",
].join(" ");

function parseProviderReply(
  raw: unknown,
  candidates: CanonicalPlantCandidate[],
): PlantIdentitySuggestionResult | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const canonicalPlantId = record.canonicalPlantId;
  if (typeof canonicalPlantId !== "string") return null;
  // A model naming an identity that does not exist is the failure mode that
  // would otherwise attach a request to nothing.
  if (!candidates.some((entry) => entry.canonicalPlantId === canonicalPlantId)) {
    return null;
  }

  const confidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0.5;
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim().slice(0, 300)
      : "Suggested by the configured AI provider.";

  return { canonicalPlantId, confidence, reason };
}

/**
 * Speaks the OpenAI chat-completions shape, which every hosted model gateway and
 * local runner now accepts, so the vendor is a URL and a model id rather than a
 * branch in this file.
 */
export function httpPlantIdentityProvider(
  config: PlantIdentityAiConfig,
): PlantIdentityProvider {
  return {
    name: config.provider,
    async suggestCanonicalPlant(name, candidates) {
      if (candidates.length === 0) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: JSON.stringify({ name, candidates }),
              },
            ],
          }),
        });
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        return parseProviderReply(payload.choices?.[0]?.message?.content, candidates);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function plantIdentityProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PlantIdentityProvider {
  const config = readPlantIdentityAiConfig(env);
  return config ? httpPlantIdentityProvider(config) : disabledPlantIdentityProvider;
}
