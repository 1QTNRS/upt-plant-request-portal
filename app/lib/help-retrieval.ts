/**
 * Retrieval over the app's own documentation, and the decision to refuse.
 *
 * Pure: no database, no network, no AI. This is the whole of what the Help
 * assistant needs — with no provider configured it is the only thing that runs,
 * and it is the only thing CI ever exercises. A provider can improve the
 * *wording* of an answer and the *choice* between passages it was handed; it
 * cannot add a passage, so it cannot add a rule.
 *
 * The refusal matters more than the coverage. A question about money, a status
 * or a percentage that the documentation does not answer has to come back as
 * "that is not documented", because a confident wrong answer here is read as a
 * business rule and acted on. So the bar is a real bar: a question whose content
 * words are largely absent from the corpus is refused even though some passage
 * always scores highest.
 */

import type { FulfillmentType } from "./growers-choice";
import {
  GLOSSARY,
  type GlossaryCategory,
  type HelpCitation,
} from "./help-glossary";
import { HELP_TOPICS } from "./help-topics";
import { editDistance } from "./plant-identity";
import type { RequestStatus } from "./portal";

export type HelpPassage = {
  id: string;
  kind: "glossary" | "topic";
  /** The term, or the topic's title. */
  title: string;
  aliases: string[];
  summary: string;
  detail: string[];
  citations: HelpCitation[];
  /** Ids of passages worth reading next. */
  seeAlso: string[];
  category?: GlossaryCategory;
};

export function helpPassages(): HelpPassage[] {
  return [
    ...GLOSSARY.map((entry) => ({
      id: entry.id,
      kind: "glossary" as const,
      title: entry.term,
      aliases: entry.aliases,
      summary: entry.summary,
      detail: entry.detail,
      citations: entry.citations,
      seeAlso: entry.seeAlso,
      category: entry.category,
    })),
    ...HELP_TOPICS.map((topic) => ({
      id: topic.id,
      kind: "topic" as const,
      title: topic.title,
      aliases: topic.aliases,
      summary: topic.summary,
      detail: topic.detail,
      citations: topic.citations,
      seeAlso: topic.seeAlso,
    })),
  ];
}

/**
 * Words that say how a question was asked rather than what it was about.
 *
 * Stemmed on the way into the set, so a variant nobody thought to list — `does`
 * reducing to the same thing as `do` — is excluded too.
 */
const RAW_STOP_WORDS = [
  "a", "about", "actually", "after", "again", "all", "also", "an", "and", "any",
  "anything", "are", "as", "ask", "at", "be", "because", "been", "before",
  "being", "both", "but", "by", "call", "called", "can", "could", "did", "do",
  "does", "doing", "done", "each", "either", "else", "even", "ever", "every",
  "exactly", "explain", "for", "from", "get", "gets", "give", "go", "goes",
  "had", "happen", "happens", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "know", "let", "like", "make", "makes", "mean",
  "means", "meaning", "me", "might", "more", "most", "much", "must", "my",
  "need", "needs", "no", "not", "now", "of", "on", "one", "only", "or", "other",
  "our", "out", "over", "own", "please", "put", "same", "say", "says", "see",
  "shall", "should", "show", "so", "some", "something", "still", "such", "sure",
  "take", "takes", "tell", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "thing", "things", "this", "those", "to", "told",
  "too", "under", "up", "us", "use", "used", "very", "want", "was", "we",
  "were", "what", "when", "where", "which", "while", "who", "why", "will",
  "with", "work", "works", "would", "you", "your",
];

/**
 * Folds the endings that change how a word is used but not what it names, so a
 * question asking what "expires" does reaches a passage about a plant whose
 * offer "expired".
 *
 * Plurals first, then verb endings, then a trailing `e` — `listings` has to
 * become `listing` before `listing` can become `list`. `us`, `is` and `ss` are
 * excluded from the plural rule because `status` is not a plural, and a result
 * shorter than four characters is left alone: `notes` reducing to `not` would
 * put a real word into the stop list.
 */
export function stemHelpToken(token: string): string {
  let stem = token;
  if (stem.length > 4 && stem.endsWith("ies")) {
    stem = `${stem.slice(0, -3)}y`;
  } else if (stem.length > 5 && stem.endsWith("es")) {
    stem = stem.slice(0, -2);
  } else if (
    stem.length > 3 &&
    stem.endsWith("s") &&
    !/(ss|us|is)$/.test(stem)
  ) {
    stem = stem.slice(0, -1);
  }

  if (stem.length > 5 && stem.endsWith("ing")) {
    stem = stem.slice(0, -3);
  } else if (stem.length > 4 && stem.endsWith("ed")) {
    stem = stem.slice(0, -2);
  }

  if (stem.length > 4 && stem.endsWith("e")) stem = stem.slice(0, -1);
  return stem;
}

const STOP_WORDS = new Set(RAW_STOP_WORDS.map(stemHelpToken));

/**
 * Every word of a phrase, stemmed, stop words included.
 *
 * Single characters are dropped: they are what punctuation leaves behind — the
 * `s` of `customer's` — and one of them matching a passage says nothing while
 * counting as a word that was asked about.
 */
export function helpTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1)
    .map(stemHelpToken);
}

/** The words that say what a question is about. */
export function helpContentTokens(value: string): string[] {
  return [...new Set(helpTokens(value).filter((token) => !STOP_WORDS.has(token)))];
}

/**
 * How far apart two words may be and still be the same word.
 *
 * One edit, and only in a word long enough for one edit to be a small part of
 * it — the same reasoning `plant-identity.ts` uses on plant names, for the same
 * reason: below that length a single edit is more likely to be a different word.
 */
export const NEAR_TERM_MAX_EDIT_DISTANCE = 1;
export const NEAR_TERM_MIN_WORD_LENGTH = 5;

function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.max(left.length, right.length) < NEAR_TERM_MIN_WORD_LENGTH) {
    return false;
  }
  return (
    editDistance(left, right, NEAR_TERM_MAX_EDIT_DISTANCE) <=
    NEAR_TERM_MAX_EDIT_DISTANCE
  );
}

export type TermMatch = {
  passageId: string;
  /** The term or alias that matched, as written. */
  matched: string;
  /** How many words long that phrase is. A longer phrase is a better match. */
  length: number;
  exact: boolean;
};

/** Whether `phrase` appears in `tokens`, allowing one slip per long word. */
function phraseAt(
  tokens: string[],
  phrase: string[],
  exactOnly: boolean,
): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
    const hit = phrase.every((word, index) =>
      exactOnly
        ? tokens[start + index] === word
        : sameWord(tokens[start + index], word),
    );
    if (hit) return true;
  }
  return false;
}

/**
 * Every glossary term or alias the question names, longest phrase first.
 *
 * An exact phrase is preferred over a near one, and a longer phrase over a
 * shorter: a question about "Approval Drop-Off" names three words, and it must
 * not be answered by the one-word term "New" that also appears in it.
 */
export function matchedTerms(
  question: string,
  passages = helpPassages(),
): TermMatch[] {
  const tokens = helpTokens(question);
  const matches: TermMatch[] = [];

  for (const passage of passages) {
    let best: TermMatch | null = null;
    for (const name of [passage.title, ...passage.aliases]) {
      const phrase = helpTokens(name);
      if (phrase.length === 0) continue;
      const exact = phraseAt(tokens, phrase, true);
      const near = exact || phraseAt(tokens, phrase, false);
      if (!near) continue;
      const candidate: TermMatch = {
        passageId: passage.id,
        matched: name,
        length: phrase.length,
        exact,
      };
      if (
        !best ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate.exact && !best.exact)
      ) {
        best = candidate;
      }
    }
    if (best) matches.push(best);
  }

  return matches.sort(
    (left, right) =>
      right.length - left.length || Number(right.exact) - Number(left.exact),
  );
}

/**
 * Extra weight for a word that is in a passage's own name rather than only
 * somewhere in its body.
 *
 * "When is the customer actually charged?" overlaps the FedEx entry, which
 * mentions being charged, and the topic called "When money is taken", which is
 * about it. Both carry the word; only one is named after it.
 */
export const HEADING_WEIGHT_BONUS = 0.75;

type PassageIndex = {
  passages: HelpPassage[];
  weightOf: (token: string) => number;
  /** Whether a single word is specific enough to name one entry by itself. */
  isDistinctive: (token: string) => boolean;
  tokensById: Map<string, Set<string>>;
  headingTokensById: Map<string, Set<string>>;
  unknownWeight: number;
};

function passageHeading(passage: HelpPassage): string {
  return [passage.title, ...passage.aliases, passage.summary].join(" ");
}

function passageText(passage: HelpPassage): string {
  return [passageHeading(passage), ...passage.detail].join(" ");
}

function buildIndex(passages: HelpPassage[]): PassageIndex {
  const tokensById = new Map<string, Set<string>>();
  const headingTokensById = new Map<string, Set<string>>();
  const documentFrequency = new Map<string, number>();

  for (const passage of passages) {
    const tokens = new Set(helpContentTokens(passageText(passage)));
    tokensById.set(passage.id, tokens);
    headingTokensById.set(
      passage.id,
      new Set(helpContentTokens(passageHeading(passage))),
    );
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const total = Math.max(1, passages.length);
  // A word in every passage says almost nothing; a word in one says a great
  // deal. A word in none says the most of all — it is the signal that the
  // question is about something this documentation does not cover — so it
  // weighs more than the rarest word that is present.
  const unknownWeight = Math.log(1 + total * 2);
  return {
    passages,
    tokensById,
    headingTokensById,
    unknownWeight,
    weightOf: (token) => {
      const frequency = documentFrequency.get(token);
      return frequency ? Math.log(1 + total / frequency) : unknownWeight;
    },
    isDistinctive: (token) =>
      (documentFrequency.get(token) ?? 0) <= total / 2,
  };
}

export type RankedPassage = {
  passage: HelpPassage;
  /** Summed weight of the question's words this passage carries. */
  score: number;
  /** Extra ordering weight for words that are in this passage's own name. */
  headingScore: number;
  /** Extra ordering weight for a passage the request context makes relevant. */
  boost: number;
  matchedTokens: string[];
  /**
   * Whether the question names something specific that this passage is *about*,
   * rather than words its body happens to use.
   */
  namesSubject: boolean;
};

/**
 * Extra weight for a passage the request in hand makes relevant.
 *
 * It moves a passage up the order and never past the bar: the decision to answer
 * at all is made on how much of the question the documentation covers, which no
 * boost touches. So context can pick the better of two documented answers and
 * can never turn a question the app cannot answer into one it will.
 */
export const CONTEXT_BOOST = 1.5;

/**
 * The terms a question actually names, once one-word aliases that name nothing
 * are dropped.
 *
 * A named term beats retrieval outright, so a one-word alias is only allowed to
 * carry that if the word belongs to the entry rather than to the documentation
 * as a whole. `offered` is an alias of Item status, but more than half the
 * passages talk about offering something, so "can we offer net-30 terms to
 * wholesale buyers?" is not a question about item statuses — and with no term
 * named, it goes to retrieval and is refused, which is the right answer.
 *
 * An entry's own title is exempt: `Expired` is one common word and is still
 * exactly what an admin typing it wants.
 */
function namedTerms(
  question: string,
  passages: HelpPassage[],
  index: PassageIndex,
): TermMatch[] {
  const titles = new Set(passages.map((passage) => passage.title));
  return matchedTerms(question, passages).filter((term) => {
    if (term.length > 1 || titles.has(term.matched)) return true;
    const [word] = helpTokens(term.matched);
    return word !== undefined && index.isDistinctive(word);
  });
}

export type HelpRequestContext = {
  requestNumber: string;
  status: RequestStatus;
  /** From `formatCustomerStatusLabel` — what the customer is shown. */
  customerStatusLabel?: string;
  hasResponded?: boolean;
  /** Undefined until an offer has been sent. */
  hasPayableItems?: boolean;
  /** When the hold ends, ISO 8601. Absent when no offer has been sent. */
  offerExpiresAtIso?: string;
  /** The routes the offered lines are on, from the offer snapshot. */
  fulfillmentTypes?: FulfillmentType[];
  paid?: boolean;
};

const STATUS_ENTRY_IDS: Record<RequestStatus, string> = {
  New: "new",
  Pending: "pending",
  Closed: "closed",
  Expired: "expired",
};

const FULFILLMENT_ENTRY_IDS: Record<FulfillmentType, string> = {
  exact_plant: "exact-plant",
  growers_choice: "growers-choice",
  not_available: "not-available",
};

/**
 * The glossary a particular request's state is written in.
 *
 * This is what makes "why is REQ123 Pending?" answerable later without the
 * answer path being rebuilt for it: the context names the terms that apply, and
 * retrieval already prefers them.
 */
export function contextPassageIds(
  context: HelpRequestContext,
  passages = helpPassages(),
): string[] {
  const known = new Set(passages.map((passage) => passage.id));
  const ids: string[] = [STATUS_ENTRY_IDS[context.status]];

  if (context.customerStatusLabel) {
    const label = context.customerStatusLabel.toLowerCase();
    const entry = passages.find(
      (passage) => passage.title.toLowerCase() === label,
    );
    if (entry) ids.push(entry.id);
  }
  if (context.hasPayableItems === false) ids.push("no-payment-needed");
  if (context.offerExpiresAtIso) ids.push("offer-hold");
  if (context.paid) ids.push("draft-order");
  for (const type of context.fulfillmentTypes ?? []) {
    ids.push(FULFILLMENT_ENTRY_IDS[type]);
  }

  return [...new Set(ids)].filter((id) => known.has(id));
}

export type HelpRanking = {
  question: string;
  /** Best first, and only passages carrying at least one of the words asked. */
  ranked: RankedPassage[];
  terms: TermMatch[];
  /** How much of what was asked the best passage accounts for, 0–1. */
  coverage: number;
  contextIds: string[];
};

export function rankHelpPassages(input: {
  question: string;
  context?: HelpRequestContext;
  passages?: HelpPassage[];
}): HelpRanking {
  const passages = input.passages ?? helpPassages();
  const index = buildIndex(passages);
  const questionTokens = helpContentTokens(input.question);
  const contextIds = input.context
    ? contextPassageIds(input.context, passages)
    : [];
  const boosted = new Set(contextIds);

  const askedWeight = questionTokens.reduce(
    (sum, token) => sum + index.weightOf(token),
    0,
  );

  const ranked: RankedPassage[] = [];
  for (const passage of passages) {
    const carried = index.tokensById.get(passage.id) ?? new Set<string>();
    const heading = index.headingTokensById.get(passage.id) ?? new Set<string>();
    const matchedTokens = questionTokens.filter((token) => carried.has(token));
    if (matchedTokens.length === 0) continue;
    const score = matchedTokens.reduce((sum, token) => sum + index.weightOf(token), 0);
    const inHeading = matchedTokens.filter((token) => heading.has(token));
    const headingScore = inHeading.reduce(
      (sum, token) => sum + index.weightOf(token) * HEADING_WEIGHT_BONUS,
      0,
    );
    ranked.push({
      passage,
      score,
      headingScore,
      boost: boosted.has(passage.id) ? CONTEXT_BOOST : 0,
      matchedTokens,
      namesSubject: inHeading.some((token) => index.isDistinctive(token)),
    });
  }

  const ordering = (entry: RankedPassage) =>
    entry.score + entry.headingScore + entry.boost;
  ranked.sort(
    (left, right) =>
      ordering(right) - ordering(left) ||
      left.passage.id.localeCompare(right.passage.id),
  );

  return {
    question: input.question,
    ranked,
    terms: namedTerms(input.question, passages, index),
    coverage: askedWeight === 0 ? 0 : (ranked[0]?.score ?? 0) / askedWeight,
    contextIds,
  };
}

/**
 * How much of a question the best passage has to account for before an answer
 * is offered without a term having been named, and how much weight that has to
 * amount to.
 *
 * Both are needed. Coverage alone would answer a two-word question from a
 * passage that happens to contain one common word; weight alone would answer a
 * long question from a passage matching a single rare one. Neither is enough on
 * its own either, which is what `namesSubject` is for: "can a customer change
 * their shipping address after paying?" is mostly words the draft-order entry
 * uses, and that entry does not say whether an address can be changed.
 */
export const MIN_QUESTION_COVERAGE = 0.5;
export const MIN_PASSAGE_SCORE = 1.2;

export type HelpMatchKind = "term" | "near_term" | "retrieval" | "provider" | "none";

export const NOT_DOCUMENTED_ANSWER =
  "That is not documented in this app's glossary, business rules or handoff notes, " +
  "so there is nothing here to answer it from. Rather than guess, this says so: a " +
  "confident wrong answer about a status, a percentage or when money is taken reads " +
  "as a business rule and gets acted on.";

export type HelpResolution = {
  documented: boolean;
  match: HelpMatchKind;
  /** Best first. Empty when nothing documented matched. */
  passages: HelpPassage[];
  /** Passages that scored but did not clear the bar, for an honest refusal. */
  nearMisses: string[];
  ranking: HelpRanking;
};

/** How many supporting passages an answer lists alongside the first. */
const MAX_SUPPORTING_PASSAGES = 2;

function withSupport(
  primary: HelpPassage,
  ranking: HelpRanking,
): HelpPassage[] {
  const supporting = ranking.ranked
    .map((entry) => entry.passage)
    .filter((passage) => passage.id !== primary.id)
    .slice(0, MAX_SUPPORTING_PASSAGES);
  return [primary, ...supporting];
}

/**
 * The one named term an answer should be about.
 *
 * Two terms can be named by the same words — "exact plants listing" contains
 * "exact plant" — so the longest phrase wins first, and among equally long ones
 * the passage the rest of the question points at. Falling back to the order the
 * glossary happens to be written in would make the answer depend on an array.
 */
function bestTerm(ranking: HelpRanking): TermMatch | undefined {
  const best = ranking.terms[0];
  if (!best) return undefined;
  const tied = ranking.terms.filter(
    (term) => term.length === best.length && term.exact === best.exact,
  );
  if (tied.length === 1) return best;

  const order = new Map(
    ranking.ranked.map((entry, index) => [entry.passage.id, index]),
  );
  return [...tied].sort(
    (left, right) =>
      (order.get(left.passageId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.passageId) ?? Number.MAX_SAFE_INTEGER),
  )[0];
}

/**
 * The passages an answer may be built from, or the decision not to answer.
 *
 * A named term wins outright: an admin who types "Approval Drop-Off" wants that
 * definition, whatever else their sentence overlaps with. Otherwise the question
 * has to be largely accounted for by one passage, and if it is not, this refuses
 * and names what nearly matched instead of answering from it.
 */
export function resolveHelpQuestion(input: {
  question: string;
  context?: HelpRequestContext;
  passages?: HelpPassage[];
}): HelpResolution {
  const passages = input.passages ?? helpPassages();
  const ranking = rankHelpPassages({ ...input, passages });
  const byId = new Map(passages.map((passage) => [passage.id, passage]));

  const term = bestTerm(ranking);
  if (term) {
    const primary = byId.get(term.passageId);
    if (primary) {
      return {
        documented: true,
        match: term.exact ? "term" : "near_term",
        passages: withSupport(primary, ranking),
        nearMisses: [],
        ranking,
      };
    }
  }

  const best = ranking.ranked[0];
  if (
    best &&
    best.namesSubject &&
    ranking.coverage >= MIN_QUESTION_COVERAGE &&
    best.score >= MIN_PASSAGE_SCORE
  ) {
    return {
      documented: true,
      match: "retrieval",
      passages: withSupport(best.passage, ranking),
      nearMisses: [],
      ranking,
    };
  }

  return {
    documented: false,
    match: "none",
    passages: [],
    nearMisses: ranking.ranked.slice(0, 3).map((entry) => entry.passage.title),
    ranking,
  };
}

/** The passage as prose: its one-line summary, then its paragraphs. */
export function passageAnswerText(passage: HelpPassage): string {
  return [passage.summary, ...passage.detail].join("\n\n");
}

export function refusalText(nearMisses: string[]): string {
  if (nearMisses.length === 0) return NOT_DOCUMENTED_ANSWER;
  const list =
    nearMisses.length === 1
      ? nearMisses[0]
      : `${nearMisses.slice(0, -1).join(", ")} and ${nearMisses[nearMisses.length - 1]}`;
  return `${NOT_DOCUMENTED_ANSWER} The nearest documented entries are ${list}, in case one of those is what you meant.`;
}

/** Where a passage's wording comes from, as one line per source. */
export function citationLines(passage: HelpPassage): string[] {
  return passage.citations.map(
    (citation) => `${citation.path} — ${citation.locator}`,
  );
}
