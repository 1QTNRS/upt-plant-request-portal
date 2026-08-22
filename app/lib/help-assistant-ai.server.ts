/**
 * Optional AI assistance for the Help assistant.
 *
 * The retrieval in `help-retrieval.ts` is the whole of what this needs: with no
 * provider configured — the default, and the only path CI takes — an admin still
 * gets the documented passage, its wording and its source. A provider can only
 * improve two things: which of the passages already retrieved best answers the
 * question, and how the answer reads.
 *
 * Two rules it may never break, mirroring the plant-identity provider:
 *
 * 1. It may only work with passages it was handed. A returned id that is not one
 *    of them is discarded, and a reply naming none of them is treated as no
 *    reply at all — so it can never introduce a rule, a status, a number or
 *    anything about payment that the documentation does not already say. The
 *    passage and its citations are shown beside whatever wording comes back.
 * 2. Its absence, failure, timeout or nonsense reply must be indistinguishable
 *    from "no improvement". The caller keeps the grounded answer.
 *
 * ## Enabling a provider
 *
 * All four variables are required together; with any of them missing the
 * disabled implementation is used and nothing is ever sent anywhere.
 *
 * | Variable | Meaning |
 * | --- | --- |
 * | `HELP_ASSISTANT_AI_PROVIDER` | Label for the vendor, e.g. `openai`, `anthropic`, `together`, `ollama`. Shown beside the answer so an admin knows who worded it |
 * | `HELP_ASSISTANT_AI_BASE_URL` | Base URL of an OpenAI-compatible chat-completions endpoint, e.g. `https://api.openai.com/v1` |
 * | `HELP_ASSISTANT_AI_MODEL` | Model id to send, e.g. `gpt-4o-mini`, `claude-sonnet-4-5`, `llama3.1:8b` |
 * | `HELP_ASSISTANT_AI_API_KEY` | Bearer token for that endpoint |
 *
 * Optional: `HELP_ASSISTANT_AI_TIMEOUT_MS` (default 8000). The call is on an
 * admin form submission, so it is aborted rather than allowed to hold the page.
 */

import {
  missingAiProviderDetail,
  readAiProviderConfig,
  requestChatCompletion,
  type AiProviderConfig,
} from "./ai-provider.server";

export const HELP_ASSISTANT_AI_PREFIX = "HELP_ASSISTANT_AI";

/** A documented passage, as it is offered to a provider. */
export type HelpGroundingPassage = {
  id: string;
  title: string;
  text: string;
};

export type HelpProviderReply = {
  /** Ids of the supplied passages the answer rests on. Never anything else. */
  passageIds: string[];
  /** Reworded answer, or null to leave the passages as they are. */
  text: string | null;
};

export interface HelpAssistantProvider {
  /** Shown beside an answer this provider worded. */
  readonly name: string;
  answerFromPassages(input: {
    question: string;
    passages: HelpGroundingPassage[];
  }): Promise<HelpProviderReply | null>;
}

/** The default. Improves nothing, which leaves the grounded answer standing. */
export const disabledHelpAssistantProvider: HelpAssistantProvider = {
  name: "disabled",
  async answerFromPassages() {
    return null;
  },
};

/**
 * Longest wording accepted from a provider. An answer to "what does Pending
 * mean" that runs past this is not a rewording of a passage.
 */
export const MAX_PROVIDER_ANSWER_CHARS = 1600;

const DEFAULT_TIMEOUT_MS = 8000;

export type HelpAssistantAiConfig = AiProviderConfig;

export function readHelpAssistantAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): HelpAssistantAiConfig | null {
  return readAiProviderConfig(HELP_ASSISTANT_AI_PREFIX, env, DEFAULT_TIMEOUT_MS);
}

export type HelpAssistantAiStatus = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  /** Shown to the admin, so a plain answer is never mistaken for a failure. */
  detail: string;
};

export function helpAssistantAiStatus(
  env: NodeJS.ProcessEnv = process.env,
): HelpAssistantAiStatus {
  const config = readHelpAssistantAiConfig(env);
  if (!config) {
    return {
      enabled: false,
      provider: null,
      model: null,
      detail: missingAiProviderDetail(
        HELP_ASSISTANT_AI_PREFIX,
        "AI assistance is off, which is the default. Answers come from the glossary and the app's documentation by exact and near term matching plus keyword retrieval, and need no credentials.",
      ),
    };
  }
  return {
    enabled: true,
    provider: config.provider,
    model: config.model,
    detail: `${config.provider} (${config.model}) is wording answers. It may only reword or choose between the passages this app retrieved, so every answer still comes from the documentation and still names its source.`,
  };
}

const SYSTEM_PROMPT = [
  "You help an admin understand a Shopify app they operate.",
  "You are given the app's own documentation as numbered passages. Answer only from those passages.",
  'Answer with JSON only: {"passageIds": string[], "text": string | null}.',
  "passageIds must contain the ids of the passages your answer rests on, in order of relevance. Use an empty array when none of them answers the question.",
  "Never state a status, a label, a threshold, a percentage, a timescale, or anything about payment or inventory that is not written in a passage you cite.",
  "Never soften a passage that says something does not happen, and never add an example.",
  "Keep the answer short, plain and specific to what was asked.",
].join(" ");

export function parseHelpProviderReply(
  raw: unknown,
  passages: HelpGroundingPassage[],
): HelpProviderReply | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const supplied = new Set(passages.map((passage) => passage.id));
  const passageIds = Array.isArray(record.passageIds)
    ? [
        ...new Set(
          record.passageIds.filter(
            (id): id is string => typeof id === "string" && supplied.has(id),
          ),
        ),
      ]
    : [];
  // A reply naming nothing that was supplied is the failure mode that would
  // otherwise let a model answer from whatever it happens to believe about
  // plant shops.
  if (passageIds.length === 0) return null;

  const text =
    typeof record.text === "string" &&
    record.text.trim() &&
    record.text.trim().length <= MAX_PROVIDER_ANSWER_CHARS
      ? record.text.trim()
      : null;

  return { passageIds, text };
}

/**
 * Speaks the OpenAI chat-completions shape, which every hosted model gateway and
 * local runner now accepts, so the vendor is a URL and a model id rather than a
 * branch in this file.
 */
export function httpHelpAssistantProvider(
  config: HelpAssistantAiConfig,
): HelpAssistantProvider {
  return {
    name: config.provider,
    async answerFromPassages({ question, passages }) {
      if (passages.length === 0) return null;

      const reply = await requestChatCompletion(config, {
        system: SYSTEM_PROMPT,
        user: JSON.stringify({ question, passages }),
      });
      return parseHelpProviderReply(reply, passages);
    },
  };
}

export function helpAssistantProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HelpAssistantProvider {
  const config = readHelpAssistantAiConfig(env);
  return config
    ? httpHelpAssistantProvider(config)
    : disabledHelpAssistantProvider;
}
