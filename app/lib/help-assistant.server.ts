/**
 * The Help assistant's answer path.
 *
 * One entry point, `answerPortalQuestion`, which takes a question and
 * optionally the derived state of one request. It reads nothing: this module
 * imports no Prisma client and no persistence, so it cannot look a customer up
 * and has nothing of theirs to leak. The context it accepts is state a caller
 * already holds.
 *
 * The order is deliberate. Retrieval decides first, from the app's own
 * documentation, whether the question is answerable at all. Only then is a
 * provider — if one is configured — offered the passages that scored, to choose
 * between them and to word the answer. A question the documentation does not
 * touch is refused before any provider is asked, so no amount of AI can turn
 * "that is not documented" into a confident answer.
 */

import {
  disabledHelpAssistantProvider,
  helpAssistantAiStatus,
  helpAssistantProviderFromEnv,
  type HelpAssistantProvider,
  type HelpGroundingPassage,
} from "./help-assistant-ai.server";
import {
  citationLines,
  helpPassages,
  passageAnswerText,
  refusalText,
  resolveHelpQuestion,
  type HelpMatchKind,
  type HelpPassage,
  type HelpRequestContext,
} from "./help-retrieval";

export type HelpAnswerSource = {
  passageId: string;
  title: string;
  /** `path — locator` for each place the passage's wording comes from. */
  citations: string[];
};

export type HelpAnswer = {
  question: string;
  /** False when nothing documented matched. `text` then says so. */
  documented: boolean;
  /** Plain text: the documented passages, or a provider's wording of them. */
  text: string;
  match: HelpMatchKind;
  /** The passages the answer rests on, best first. Empty on a refusal. */
  passages: HelpPassage[];
  sources: HelpAnswerSource[];
  /** Terms worth reading next. */
  seeAlso: string[];
  /** Set when a provider worded the answer; null when none is configured. */
  phrasing: { provider: string; model: string | null } | null;
  /** The request the question was asked about, when one was supplied. */
  context?: HelpRequestContext;
};

/**
 * How many passages a provider may choose between.
 *
 * Enough that a question phrased around the wrong word can still land on the
 * right entry, few enough that the prompt stays a set of passages rather than
 * the whole glossary — which would make the provider the thing doing the
 * retrieval.
 */
export const MAX_PROVIDER_CANDIDATES = 6;

function sourcesOf(passages: HelpPassage[]): HelpAnswerSource[] {
  return passages.map((passage) => ({
    passageId: passage.id,
    title: passage.title,
    citations: citationLines(passage),
  }));
}

function seeAlsoTitles(
  passages: HelpPassage[],
  all: HelpPassage[],
): string[] {
  const shown = new Set(passages.map((passage) => passage.id));
  const titles: string[] = [];
  for (const id of passages.flatMap((passage) => passage.seeAlso)) {
    if (shown.has(id)) continue;
    const related = all.find((passage) => passage.id === id);
    if (related && !titles.includes(related.title)) titles.push(related.title);
  }
  return titles;
}

function groundingPassages(passages: HelpPassage[]): HelpGroundingPassage[] {
  return passages.map((passage) => ({
    id: passage.id,
    title: passage.title,
    text: passageAnswerText(passage),
  }));
}

export async function answerPortalQuestion(input: {
  question: string;
  /** Optional. Lets a later caller ask about one request without this changing. */
  context?: HelpRequestContext;
  /** Injected in tests; otherwise read from the environment. */
  provider?: HelpAssistantProvider;
  /** The model behind `provider`, for the record shown to the admin. */
  model?: string | null;
  passages?: HelpPassage[];
}): Promise<HelpAnswer> {
  const all = input.passages ?? helpPassages();
  const question = input.question.trim();
  const base = {
    question,
    match: "none" as HelpMatchKind,
    passages: [],
    sources: [],
    seeAlso: [],
    phrasing: null,
    ...(input.context ? { context: input.context } : {}),
  };

  if (!question) {
    return {
      ...base,
      documented: false,
      text: "Ask a question about how the portal works, or pick a term from the glossary below.",
    };
  }

  const resolution = resolveHelpQuestion({
    question,
    context: input.context,
    passages: all,
  });

  const grounded: HelpAnswer = resolution.documented
    ? {
        ...base,
        documented: true,
        match: resolution.match,
        text: passageAnswerText(resolution.passages[0]),
        passages: resolution.passages,
        sources: sourcesOf(resolution.passages),
        seeAlso: seeAlsoTitles(resolution.passages, all),
      }
    : {
        ...base,
        documented: false,
        text: refusalText(resolution.nearMisses),
      };

  const provider = input.provider ?? helpAssistantProviderFromEnv();
  if (provider === disabledHelpAssistantProvider) return grounded;

  // Nothing scored at all means the question shares no vocabulary with the
  // documentation, so there is nothing for a provider to choose between and
  // asking one could only invent an answer.
  const candidates = resolution.ranking.ranked
    .slice(0, MAX_PROVIDER_CANDIDATES)
    .map((entry) => entry.passage);
  if (candidates.length === 0) return grounded;

  let reply;
  try {
    reply = await provider.answerFromPassages({
      question,
      passages: groundingPassages(candidates),
    });
  } catch {
    // A provider that is down, slow or unreachable is the same as one that is
    // absent. The grounded answer was already complete without it.
    return grounded;
  }
  if (!reply) return grounded;

  const chosen = reply.passageIds
    .map((id) => candidates.find((passage) => passage.id === id))
    .filter((passage): passage is HelpPassage => passage !== undefined);
  if (chosen.length === 0) return grounded;

  const model =
    input.model === undefined ? helpAssistantAiStatus().model : input.model;

  return {
    ...base,
    documented: true,
    match: "provider",
    text: reply.text ?? passageAnswerText(chosen[0]),
    passages: chosen,
    sources: sourcesOf(chosen),
    seeAlso: seeAlsoTitles(chosen, all),
    phrasing: { provider: provider.name, model },
  };
}

export { helpAssistantAiStatus };
