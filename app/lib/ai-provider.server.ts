/**
 * The one shape an optional AI provider takes in this app.
 *
 * Every AI assist here is configured the same way — a vendor label, the base URL
 * of an OpenAI-compatible chat-completions endpoint, a model id and a bearer
 * token, all four required together — and every one of them defaults to off. The
 * vendor is a URL and a model id rather than a branch in this file, which is
 * what keeps any of it from being hard-coded to one company.
 *
 * Feature modules own their prompts, their reply validation and the wording of
 * their status line, because those are the parts that decide what an answer is
 * allowed to do. What they share is the configuration contract and the request,
 * so there is one place where "which variables turn this on" is decided and one
 * place a timeout can be forgotten.
 */

export type AiProviderConfig = {
  /** The variable prefix this configuration was read from. */
  prefix: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type AiProviderVariableNames = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: string;
};

export function aiProviderVariableNames(prefix: string): AiProviderVariableNames {
  return {
    provider: `${prefix}_PROVIDER`,
    baseUrl: `${prefix}_BASE_URL`,
    model: `${prefix}_MODEL`,
    apiKey: `${prefix}_API_KEY`,
    timeoutMs: `${prefix}_TIMEOUT_MS`,
  };
}

/**
 * The four required variables, or null when any of them is missing.
 *
 * Null is the default and the only state CI ever runs in, so a caller that
 * treats it as "no provider" needs no credential to be correct.
 */
export function readAiProviderConfig(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
  defaultTimeoutMs = 5000,
): AiProviderConfig | null {
  const names = aiProviderVariableNames(prefix);
  const provider = env[names.provider]?.trim();
  const baseUrl = env[names.baseUrl]?.trim();
  const model = env[names.model]?.trim();
  const apiKey = env[names.apiKey]?.trim();
  if (!provider || !baseUrl || !model || !apiKey) return null;

  const timeout = Number.parseInt(env[names.timeoutMs]?.trim() || "", 10);
  return {
    prefix,
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    timeoutMs:
      Number.isFinite(timeout) && timeout > 0 ? timeout : defaultTimeoutMs,
  };
}

export type AiProviderStatus = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  /** Shown to the admin so "no AI happened" is never a mystery. */
  detail: string;
};

/**
 * The message an owner reads when a provider is not configured. It names the
 * variables rather than telling them to read the source.
 */
export function missingAiProviderDetail(prefix: string, purpose: string): string {
  const names = aiProviderVariableNames(prefix);
  return (
    `${purpose} Set ${names.provider}, ${names.baseUrl}, ${names.model} and ` +
    `${names.apiKey} to add AI assistance.`
  );
}

/**
 * One chat completion, returning the assistant's message content.
 *
 * Errors are not swallowed: a caller decides whether a failed assist is a
 * silent "no answer" or something to report. Both existing callers treat a
 * rejection as "no answer", which is what makes the absence of a provider and
 * the failure of one indistinguishable.
 */
export async function requestChatCompletion(
  config: AiProviderConfig,
  input: { system: string; user: string },
): Promise<string | null> {
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
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } finally {
    clearTimeout(timer);
  }
}
