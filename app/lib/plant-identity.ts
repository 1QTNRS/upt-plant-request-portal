/**
 * Canonical plant identity: the deterministic half.
 *
 * A customer typing `H. carnosa`, `hoya  carnosa` and `Hoya carnosa` has asked
 * for the same plant three times, and the owner's analytics are worthless if
 * those land on three rows. This module decides when two spellings are the same
 * plant, with no network call and no AI — which is the only path CI and the
 * production default ever take.
 *
 * It is deliberately timid. Merging two genuinely different plants silently
 * corrupts every per-plant figure and the owner has no way to see it happened,
 * whereas leaving a pair separate is visible and reversible. So anything that
 * might distinguish two plants — a cultivar, an accession or clone number, a
 * collector code, a locality, any extra word at all beyond the binomial — blocks
 * an automatic merge outright, and the only formatting differences it forgives
 * are the ones that cannot change which plant is meant.
 */

/**
 * Rank and qualifier words that carry no identity of their own.
 *
 * `Hoya sp.` and `Hoya` are the same request; `Hoya sp. AH-021` is not, because
 * the code after the rank is the identity.
 */
const RANK_WORDS = new Set([
  "sp",
  "spp",
  "ssp",
  "subsp",
  "var",
  "cv",
  "form",
  "forma",
  "f",
  "aff",
  "cf",
  "hybrid",
  "x",
]);

/** Words after which the rest of the name is a locality, not a taxon. */
const LOCALITY_WORDS = new Set(["ex", "from", "collected", "locality"]);

/**
 * How far apart two spellings may be and still count as the same plant.
 *
 * One edit is a slipped, doubled or dropped key — `carnsa` and `carnoosa` for
 * `carnosa` — and it is the overwhelmingly common way a real name is misspelled,
 * so it is taken automatically. Two edits is still usually a typo but is also
 * how far apart some real epithets are, so it only ever produces a suggestion.
 * Beyond that the pair is left alone.
 */
export const HIGH_CONFIDENCE_MAX_EDIT_DISTANCE = 1;
export const MEDIUM_CONFIDENCE_MAX_EDIT_DISTANCE = 2;

/**
 * Shortest word an edit may be forgiven in.
 *
 * Six characters means a single edit is at most a sixth of the word, and it
 * keeps genus names out: `Hoya` and `Hoya`-like genera are four or five letters,
 * where one edit is a large fraction of the word and far more likely to be a
 * different genus than a typo.
 */
export const MIN_TYPO_WORD_LENGTH = 6;

/**
 * Share of a word a run of edits may consume before the pair is left alone.
 *
 * Guards the medium tier on short epithets: two edits in an eight-letter word is
 * a quarter of it, which is as far as "probably a typo" stretches.
 */
export const MAX_TYPO_DISTANCE_RATIO = 0.25;

export type PlantMatchConfidence = "high" | "medium" | "low";

export type PlantMatchReason =
  | "exact"
  | "genus_abbreviation"
  | "typo"
  | "distinguishing_qualifier"
  | "different_plant";

export type NormalizedPlantName = {
  /** Exactly what was passed in, untouched. */
  originalName: string;
  /**
   * Lookup key for the whole name, qualifiers included. Two names with the same
   * key are the same plant by definition.
   */
  key: string;
  /**
   * The name with its whitespace tidied and nothing else changed.
   *
   * The identity is internal, but its label is what the owner reads on every
   * plant table, so it stays the wording the shop actually used. Re-casing it to
   * botanical convention turned `Monstera Albo` and `Thai Constellation` into
   * something nobody had typed.
   */
  displayName: string;
  /** Genus, lowercased. Ends in `.` when the customer abbreviated it. */
  genus: string;
  /** Species epithet, lowercased, or `""` for a genus-only request. */
  epithet: string;
  /**
   * Everything that is not the binomial: cultivars, accession and clone numbers,
   * collector codes, localities, and any other trailing word. Present on either
   * side and different, this blocks a merge.
   */
  qualifiers: string[];
};

export type PlantNameMatch = {
  confidence: PlantMatchConfidence;
  reason: PlantMatchReason;
  /** 0–1. Only meaningful for ordering candidates against each other. */
  score: number;
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Folds away the punctuation that only ever varies by how someone types, and
 * leaves the punctuation that carries meaning.
 *
 * Quotes go because `'Krimson Queen'`, `‘Krimson Queen’` and `"Krimson Queen"`
 * are one cultivar written three ways — the words inside are kept and still act
 * as a qualifier. Hyphens in a collector code do not: `IML-0123` and `IML 0123`
 * are the same accession, so the separator is normalised to a space and the
 * digits survive.
 */
function foldPunctuation(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00d7/g, "x")
    .replace(/['"`\u2018-\u201f\u2032\u2033()[\]{}]/g, " ")
    .replace(/[-_/\\,;:]/g, " ")
    // A period between a code and its number is a separator, and letters run
    // into digits as often as they are spaced from them, so `AH-021`, `AH 021`,
    // `AH021` and `sp.021` all reduce to the same tokens. Splitting them apart
    // cannot collapse two different codes, because the digits survive intact.
    .replace(/\.(?=\d)/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** `sp.` and `sp` are the same word; the trailing period is noise. */
function stripRankPeriod(token: string): string {
  return token.endsWith(".") && RANK_WORDS.has(token.slice(0, -1))
    ? token.slice(0, -1)
    : token;
}

function isAbbreviation(token: string): boolean {
  return token.endsWith(".") && /^[a-z]+\.$/.test(token);
}

/**
 * Splits a name into the binomial and everything that might distinguish it.
 *
 * The rule is that the taxon core is at most a genus and one epithet: any
 * further word is treated as distinguishing, whether or not it looks like a
 * cultivar. That is what keeps `Hoya carnosa compacta`, `Hoya carnosa 'Krimson
 * Queen'` and `Hoya carnosa AH-021` off the `Hoya carnosa` row without needing
 * to recognise any of them, and it is the reason a merge can be trusted: the
 * only names that reach it are ones with nothing left over.
 */
export function parsePlantName(raw: string): NormalizedPlantName {
  const originalName = raw ?? "";
  const folded = foldPunctuation(originalName);
  const tokens = folded.split(" ").filter(Boolean);

  let genus = "";
  let epithet = "";
  const qualifiers: string[] = [];
  let inLocality = false;

  for (const rawToken of tokens) {
    // Digits are never part of a binomial. Accession, collection, clone and
    // seedling numbers all arrive this way, and two of them differing is the
    // clearest possible signal that these are two different plants.
    if (/\d/.test(rawToken)) {
      qualifiers.push(rawToken);
      continue;
    }
    // Nothing is a rank or a locality until a genus has been read: `f.` opening
    // a name is Ficus, not the `f.` that marks a form, and stripping it as a
    // rank would leave the epithet standing in for the genus.
    if (!genus) {
      genus = rawToken;
      continue;
    }

    const token = stripRankPeriod(rawToken);

    if (inLocality) {
      qualifiers.push(token);
      continue;
    }
    if (LOCALITY_WORDS.has(token)) {
      inLocality = true;
      qualifiers.push(token);
      continue;
    }
    // A rank word only ever qualifies the plant when something follows it, and
    // that something is caught as a qualifier in its own right below.
    if (RANK_WORDS.has(token)) continue;
    if (!epithet && !isAbbreviation(token)) {
      epithet = token;
      continue;
    }
    qualifiers.push(token);
  }

  const sortedQualifiers = [...qualifiers].sort();
  const key = [genus, epithet, ...sortedQualifiers].filter(Boolean).join(" ");

  return {
    originalName,
    key,
    displayName: originalName.trim().replace(/\s+/g, " "),
    genus,
    epithet,
    qualifiers: sortedQualifiers,
  };
}

/**
 * The stable lookup key for a spelling. Identical keys are the same plant with
 * no further judgement; everything else goes through `comparePlantNames`.
 */
export function canonicalPlantKey(raw: string): string {
  return parsePlantName(raw).key;
}

/** Levenshtein distance, bounded so a hopeless pair costs nothing to reject. */
export function editDistance(left: string, right: string, limit = 4): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      rowBest = Math.min(rowBest, current[j]);
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

/**
 * Whether one genus token is the other written short.
 *
 * `h.` matches `hoya`, and so would it match `homalomena` — an abbreviation is
 * ambiguous by construction, so this only ever contributes when the epithet
 * already matches, and the caller still has to deal with two candidate genera
 * both starting with the same letter.
 */
function expandsTo(abbreviated: string, full: string): boolean {
  if (!isAbbreviation(abbreviated)) return false;
  const stem = abbreviated.slice(0, -1);
  return stem.length > 0 && full.length > stem.length && full.startsWith(stem);
}

function sameGenus(left: string, right: string): "exact" | "abbreviated" | null {
  if (left === right) return "exact";
  if (expandsTo(left, right) || expandsTo(right, left)) return "abbreviated";
  return null;
}

/** A word one slip away from another, and long enough for that to be likely. */
function typoDistance(left: string, right: string): number | null {
  if (!left || !right) return null;
  // A digit differing is a different accession, clone or seedling, never a
  // mistyped letter.
  if (/\d/.test(left) || /\d/.test(right)) return null;
  const longest = Math.max(left.length, right.length);
  if (longest < MIN_TYPO_WORD_LENGTH) return null;
  const distance = editDistance(left, right, MEDIUM_CONFIDENCE_MAX_EDIT_DISTANCE);
  if (distance > MEDIUM_CONFIDENCE_MAX_EDIT_DISTANCE) return null;
  if (distance / longest > MAX_TYPO_DISTANCE_RATIO) return null;
  return distance;
}

const NO_MATCH: PlantNameMatch = {
  confidence: "low",
  reason: "different_plant",
  score: 0,
};

/**
 * How confidently two spellings are the same plant.
 *
 * `high` may be acted on without asking: the names differ only in ways that
 * cannot change which plant is meant. `medium` is a question for the owner and
 * merges nothing on its own. `low` is two different plants as far as this
 * function is concerned, and they stay apart silently.
 */
export function comparePlantNames(
  left: NormalizedPlantName | string,
  right: NormalizedPlantName | string,
): PlantNameMatch {
  const a = typeof left === "string" ? parsePlantName(left) : left;
  const b = typeof right === "string" ? parsePlantName(right) : right;

  if (!a.genus || !b.genus) return NO_MATCH;
  if (a.key === b.key) return { confidence: "high", reason: "exact", score: 1 };

  // Anything the customer added beyond the binomial is assumed to identify a
  // specific plant — a cultivar, an accession, a clone, a locality — so a pair
  // that does not carry the same set of them is never merged, and a typo inside
  // one is not forgiven either.
  if (
    a.qualifiers.length !== b.qualifiers.length ||
    a.qualifiers.some((value, index) => value !== b.qualifiers[index])
  ) {
    return {
      confidence: "low",
      reason: "distinguishing_qualifier",
      score: 0,
    };
  }

  const genus = sameGenus(a.genus, b.genus);
  if (!genus) {
    // Both spellings wrote the genus out and they disagree. A single slip in a
    // long genus name is still worth asking about; a short one is not, and an
    // abbreviation against a different letter never is.
    if (isAbbreviation(a.genus) || isAbbreviation(b.genus)) return NO_MATCH;
    if (a.epithet !== b.epithet) return NO_MATCH;
    const distance = typoDistance(a.genus, b.genus);
    if (distance == null) return NO_MATCH;
    return { confidence: "medium", reason: "typo", score: 0.7 };
  }

  // Same epithet and the same qualifiers, so the keys can only differ by how the
  // genus was written — a rank word or a punctuation difference would already
  // have produced the same key and been reported as exact above.
  if (a.epithet === b.epithet) {
    return { confidence: "high", reason: "genus_abbreviation", score: 0.95 };
  }

  // One side named a species and the other did not. `Hoya` is a standing request
  // for the genus, not a shorthand for whichever Hoya was asked for last.
  if (!a.epithet || !b.epithet) return NO_MATCH;

  const distance = typoDistance(a.epithet, b.epithet);
  if (distance == null) return NO_MATCH;
  if (
    distance <= HIGH_CONFIDENCE_MAX_EDIT_DISTANCE &&
    genus === "exact" &&
    a.qualifiers.length === 0
  ) {
    return { confidence: "high", reason: "typo", score: 0.85 };
  }
  return { confidence: "medium", reason: "typo", score: 0.65 };
}

/**
 * The best candidate for a spelling, or null when nothing is close.
 *
 * Ambiguity is downgraded rather than guessed at: two candidates that match
 * equally well — `H. carnosa` against both `Hoya carnosa` and `Hedera carnosa` —
 * become a question for the owner instead of a coin toss.
 */
export function bestPlantNameMatch<T extends { names: string[] }>(
  name: string,
  candidates: T[],
): { candidate: T; match: PlantNameMatch } | null {
  const parsed = parsePlantName(name);
  const scored: Array<{ candidate: T; match: PlantNameMatch }> = [];

  for (const candidate of candidates) {
    let best: PlantNameMatch = NO_MATCH;
    for (const candidateName of candidate.names) {
      const match = comparePlantNames(parsed, candidateName);
      if (match.score > best.score) best = match;
    }
    if (best.score > 0) scored.push({ candidate, match: best });
  }

  if (scored.length === 0) return null;
  scored.sort((left, right) => right.match.score - left.match.score);

  const winner = scored[0];
  const tied = scored.filter(
    (entry) => entry.match.score === winner.match.score,
  );
  if (tied.length > 1 && winner.match.confidence === "high") {
    return {
      candidate: winner.candidate,
      match: { ...winner.match, confidence: "medium" },
    };
  }
  return winner;
}
