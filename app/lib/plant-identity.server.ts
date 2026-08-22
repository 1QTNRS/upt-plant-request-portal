import prisma from "../db.server";
import {
  bestPlantNameMatch,
  canonicalPlantKey,
  parsePlantName,
  type PlantMatchConfidence,
} from "./plant-identity";
import {
  disabledPlantIdentityProvider,
  plantIdentityProviderFromEnv,
  type CanonicalPlantCandidate,
  type PlantIdentityProvider,
} from "./plant-identity-ai.server";
/**
 * Submission order, so the earliest spelling a shop used becomes the identity's
 * display name. Spelled out here rather than imported from `portal.server.ts`,
 * which imports this module.
 */
const ITEM_ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/** What an unparseable name is filed under, matching the analytics fallback. */
export const UNKNOWN_PLANT_KEY = "unknown";
export const UNKNOWN_PLANT_DISPLAY_NAME = "Unknown";

export type ResolvedPlantIdentity = {
  canonicalPlantId: string;
  canonicalKey: string;
  displayName: string;
  /** How the spelling reached this identity. */
  confidence: PlantMatchConfidence;
  reason: string;
  /** Set when the resolver logged a question for the admin instead of merging. */
  suggestionId?: string;
};

type ResolveOptions = {
  /** Defaults to whatever the environment configures, which is normally none. */
  provider?: PlantIdentityProvider;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function findOrCreateCanonicalPlant(
  shop: string,
  canonicalKey: string,
  displayName: string,
) {
  // Upsert rather than read-then-create: two plants submitted in the same
  // request are resolved back to back, and a shop's first two requests for the
  // same plant can arrive at once.
  return prisma.canonicalPlant.upsert({
    where: { shop_canonicalKey: { shop, canonicalKey } },
    create: { shop, canonicalKey, displayName },
    // The first spelling the shop saw stays the display name — it is the one the
    // owner will recognise — so this only keeps the payload non-empty enough for
    // Prisma to emit an atomic upsert rather than emulating one.
    update: { canonicalKey },
  });
}

async function recordAlias(
  shop: string,
  aliasKey: string,
  originalName: string,
  canonicalPlantId: string,
  source: "deterministic" | "admin_confirmed",
): Promise<void> {
  await prisma.plantNameAlias.upsert({
    where: { shop_aliasKey: { shop, aliasKey } },
    create: { shop, aliasKey, originalName, canonicalPlantId, source },
    // An admin's answer is the last word: it may repoint an alias the normaliser
    // created, but a later deterministic pass must never undo it.
    update:
      source === "admin_confirmed"
        ? { canonicalPlantId, source }
        : { aliasKey },
  });
}

/**
 * Candidate identities for a name, with every spelling already mapped to each.
 *
 * A shop's plant vocabulary is small — hundreds of identities at the very most —
 * so this is loaded whole rather than reached for with a similarity query no
 * SQLite build would support anyway.
 */
async function loadCandidates(shop: string) {
  return prisma.canonicalPlant.findMany({
    where: { shop },
    include: { aliases: { select: { originalName: true, aliasKey: true } } },
  });
}

/**
 * Files a spelling under an identity, or asks the admin about it.
 *
 * `high` attaches the spelling to the matched identity and remembers the mapping
 * for next time. `medium` gives the spelling an identity of its own and records a
 * suggestion — the two stay apart in every figure until someone answers. `low` is
 * silent. A pair the admin has already answered Keep Separate is never raised
 * again.
 */
export async function resolvePlantIdentity(
  shop: string,
  plantName: string,
  options: ResolveOptions = {},
): Promise<ResolvedPlantIdentity> {
  const parsed = parsePlantName(plantName);
  const aliasKey = parsed.key || UNKNOWN_PLANT_KEY;
  const displayName = parsed.displayName || UNKNOWN_PLANT_DISPLAY_NAME;

  const existingAlias = await prisma.plantNameAlias.findUnique({
    where: { shop_aliasKey: { shop, aliasKey } },
    include: { canonicalPlant: true },
  });
  if (existingAlias) {
    return {
      canonicalPlantId: existingAlias.canonicalPlantId,
      canonicalKey: existingAlias.canonicalPlant.canonicalKey,
      displayName: existingAlias.canonicalPlant.displayName,
      confidence: "high",
      reason:
        existingAlias.source === "admin_confirmed"
          ? "Confirmed by an admin as the same plant."
          : "Already mapped to this plant.",
    };
  }

  const candidates = await loadCandidates(shop);
  const match =
    parsed.key.length > 0
      ? bestPlantNameMatch(
          plantName,
          candidates.map((candidate) => ({
            canonical: candidate,
            names: [
              candidate.displayName,
              ...candidate.aliases.map((alias) => alias.originalName),
            ],
          })),
        )
      : null;

  if (match?.match.confidence === "high") {
    const canonical = match.candidate.canonical;
    await recordAlias(shop, aliasKey, plantName, canonical.id, "deterministic");
    return {
      canonicalPlantId: canonical.id,
      canonicalKey: canonical.canonicalKey,
      displayName: canonical.displayName,
      confidence: "high",
      reason: describeReason(match.match.reason),
    };
  }

  const canonical = await findOrCreateCanonicalPlant(shop, aliasKey, displayName);
  await recordAlias(shop, aliasKey, plantName, canonical.id, "deterministic");

  const identity: ResolvedPlantIdentity = {
    canonicalPlantId: canonical.id,
    canonicalKey: canonical.canonicalKey,
    displayName: canonical.displayName,
    confidence: match?.match.confidence ?? "low",
    reason: match ? describeReason(match.match.reason) : "New plant.",
  };

  const suggested =
    match?.match.confidence === "medium"
      ? {
          canonicalPlantId: match.candidate.canonical.id,
          confidence: match.match.score,
          reason: describeReason(match.match.reason),
          source: "deterministic" as const,
        }
      : await aiSuggestion(shop, plantName, canonical.id, candidates, options);

  if (suggested && suggested.canonicalPlantId !== canonical.id) {
    const suggestion = await recordSuggestion(shop, {
      aliasKey,
      originalName: plantName,
      ...suggested,
    });
    if (suggestion) {
      identity.confidence = "medium";
      identity.suggestionId = suggestion.id;
    } else {
      // The admin has already answered this pair Keep Separate, so it is settled
      // rather than pending, and nothing should raise it again.
      identity.confidence = "low";
      identity.reason = "Kept separate: an admin answered Keep Separate for this pair.";
    }
  }

  return identity;
}

/**
 * Asks the configured provider, when there is one.
 *
 * Everything here is best effort: no provider, a refused request, a timeout or a
 * reply naming an identity that does not exist all come back as null and leave
 * the deterministic answer standing.
 */
async function aiSuggestion(
  shop: string,
  plantName: string,
  ownCanonicalPlantId: string,
  candidates: Awaited<ReturnType<typeof loadCandidates>>,
  options: ResolveOptions,
) {
  const provider = options.provider ?? plantIdentityProviderFromEnv();
  if (provider === disabledPlantIdentityProvider) return null;

  const payload: CanonicalPlantCandidate[] = candidates
    .filter((candidate) => candidate.id !== ownCanonicalPlantId)
    .map((candidate) => ({
      canonicalPlantId: candidate.id,
      displayName: candidate.displayName,
      aliases: candidate.aliases.map((alias) => alias.originalName),
    }));
  if (payload.length === 0) return null;

  try {
    const result = await provider.suggestCanonicalPlant(plantName, payload);
    if (!result) return null;
    return {
      canonicalPlantId: result.canonicalPlantId,
      confidence: result.confidence,
      reason: result.reason,
      source: provider.name,
    };
  } catch (error) {
    // Suggestion quality is the only thing that degrades, so this is logged and
    // forgotten rather than surfaced.
    console.warn(
      `Plant identity AI provider "${provider.name}" failed for shop ${shop}.`,
      error,
    );
    return null;
  }
}

function describeReason(reason: string): string {
  switch (reason) {
    case "exact":
      return "Same name after normalising capitalisation, spacing and punctuation.";
    case "genus_abbreviation":
      return "Same species, with the genus abbreviated.";
    case "rank_only":
      return "Same plant, with a rank word such as `sp.` on one side only.";
    case "typo":
      return "One or two characters apart — most likely a misspelling.";
    case "distinguishing_qualifier":
      return "Kept separate: the names carry different cultivars, numbers or localities.";
    default:
      return "No close match.";
  }
}

/**
 * Records a question for the admin, unless they have already answered it.
 *
 * Keep Separate is remembered forever: the row survives as `rejected` so the
 * same pair cannot reappear on the queue the next time the customer types it.
 */
async function recordSuggestion(
  shop: string,
  input: {
    aliasKey: string;
    originalName: string;
    canonicalPlantId: string;
    confidence: number;
    reason: string;
    source: string;
  },
) {
  const existing = await prisma.plantIdentitySuggestion.findUnique({
    where: {
      shop_aliasKey_suggestedCanonicalPlantId: {
        shop,
        aliasKey: input.aliasKey,
        suggestedCanonicalPlantId: input.canonicalPlantId,
      },
    },
  });
  if (existing) return existing.status === "open" ? existing : null;

  try {
    return await prisma.plantIdentitySuggestion.create({
      data: {
        shop,
        aliasKey: input.aliasKey,
        originalName: input.originalName,
        suggestedCanonicalPlantId: input.canonicalPlantId,
        confidence: input.confidence,
        reason: input.reason,
        source: input.source,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
}

export type PlantIdentitySuggestionRow = {
  id: string;
  /** Exactly what the customer typed. */
  originalName: string;
  suggestedDisplayName: string;
  suggestedCanonicalPlantId: string;
  /** Spellings already counted under the suggested identity. */
  suggestedVariants: string[];
  reason: string;
  source: string;
  confidence: number;
  /** How many request lines would move if this were confirmed. */
  affectedItems: number;
};

export async function listPlantIdentitySuggestions(
  shop: string,
): Promise<PlantIdentitySuggestionRow[]> {
  const suggestions = await prisma.plantIdentitySuggestion.findMany({
    where: { shop, status: "open" },
    include: {
      suggestedCanonicalPlant: {
        include: { aliases: { select: { originalName: true } } },
      },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  });
  if (suggestions.length === 0) return [];

  const aliases = await prisma.plantNameAlias.findMany({
    where: { shop, aliasKey: { in: suggestions.map((row) => row.aliasKey) } },
    select: { aliasKey: true, canonicalPlantId: true },
  });
  const aliasCanonical = new Map(
    aliases.map((alias) => [alias.aliasKey, alias.canonicalPlantId]),
  );

  const counts = await prisma.requestItem.groupBy({
    by: ["canonicalPlantId"],
    where: {
      request: { shop },
      canonicalPlantId: { in: [...new Set(aliasCanonical.values())] },
    },
    _count: { _all: true },
  });
  const itemCounts = new Map<string, number>(
    counts.flatMap((row) =>
      row.canonicalPlantId ? [[row.canonicalPlantId, row._count._all] as const] : [],
    ),
  );

  return suggestions.map((row) => ({
    id: row.id,
    originalName: row.originalName,
    suggestedDisplayName: row.suggestedCanonicalPlant.displayName,
    suggestedCanonicalPlantId: row.suggestedCanonicalPlantId,
    suggestedVariants: [
      ...new Set(
        row.suggestedCanonicalPlant.aliases.map((alias) => alias.originalName),
      ),
    ].sort(),
    reason: row.reason,
    source: row.source,
    confidence: row.confidence,
    affectedItems:
      itemCounts.get(aliasCanonical.get(row.aliasKey) ?? "") ?? 0,
  }));
}

/**
 * Same Plant: folds the spelling's identity into the suggested one, permanently.
 *
 * Everything moves — the request lines, the other spellings that had collected
 * under the losing identity, and the suggestions that pointed at it — and the
 * alias is marked `admin_confirmed` so a later deterministic pass cannot undo the
 * answer. That is what makes the mapping outlive this suggestion: the next
 * identical or near-identical spelling matches the alias directly and never
 * reaches the queue.
 */
export async function confirmPlantIdentitySuggestion(
  shop: string,
  suggestionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const suggestion = await prisma.plantIdentitySuggestion.findFirst({
    where: { id: suggestionId, shop },
  });
  if (!suggestion) return { ok: false, error: "That suggestion is no longer open." };

  const alias = await prisma.plantNameAlias.findUnique({
    where: { shop_aliasKey: { shop, aliasKey: suggestion.aliasKey } },
  });
  const losingId = alias?.canonicalPlantId;
  const winningId = suggestion.suggestedCanonicalPlantId;

  await prisma.$transaction(async (tx) => {
    if (losingId && losingId !== winningId) {
      await tx.requestItem.updateMany({
        where: { canonicalPlantId: losingId },
        data: { canonicalPlantId: winningId },
      });
      await tx.plantNameAlias.updateMany({
        where: { shop, canonicalPlantId: losingId },
        data: { canonicalPlantId: winningId, source: "admin_confirmed" },
      });
      // Suggestions aimed at the identity that just disappeared would otherwise
      // vanish with it via the cascade, taking any Keep Separate answer with
      // them.
      await tx.plantIdentitySuggestion.updateMany({
        where: { shop, suggestedCanonicalPlantId: losingId },
        data: { suggestedCanonicalPlantId: winningId },
      });
      await tx.canonicalPlant.deleteMany({ where: { id: losingId, shop } });
    }

    await tx.plantNameAlias.upsert({
      where: { shop_aliasKey: { shop, aliasKey: suggestion.aliasKey } },
      create: {
        shop,
        aliasKey: suggestion.aliasKey,
        originalName: suggestion.originalName,
        canonicalPlantId: winningId,
        source: "admin_confirmed",
      },
      update: { canonicalPlantId: winningId, source: "admin_confirmed" },
    });

    await tx.plantIdentitySuggestion.updateMany({
      where: { shop, aliasKey: suggestion.aliasKey, status: "open" },
      data: { status: "confirmed", resolvedAt: new Date() },
    });
  });

  return { ok: true };
}

/** Keep Separate. Remembered so the pair is never proposed again. */
export async function rejectPlantIdentitySuggestion(
  shop: string,
  suggestionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { count } = await prisma.plantIdentitySuggestion.updateMany({
    where: { id: suggestionId, shop, status: "open" },
    data: { status: "rejected", resolvedAt: new Date() },
  });
  return count === 1
    ? { ok: true }
    : { ok: false, error: "That suggestion is no longer open." };
}

/**
 * Gives an identity to every request line that has none.
 *
 * Rows written before this existed carry only the customer's text, and a
 * migration cannot normalise a name, so they are claimed here instead. Idempotent
 * and safe to re-run: it only ever looks at rows where `canonicalPlantId` is
 * null, so a second pass over an already-resolved shop does one indexed query and
 * stops. Oldest first, so the earliest spelling a shop used becomes the identity's
 * display name, exactly as it would have if this had always been running.
 */
export async function backfillCanonicalPlants(
  shop: string,
  options: ResolveOptions & { limit?: number } = {},
): Promise<number> {
  const pending = await prisma.requestItem.findMany({
    where: { canonicalPlantId: null, request: { shop } },
    select: { id: true, plantName: true },
    orderBy: [{ request: { submittedAt: "asc" } }, ...ITEM_ORDER],
    ...(options.limit ? { take: options.limit } : {}),
  });
  if (pending.length === 0) return 0;

  let resolved = 0;
  for (const item of pending) {
    const identity = await resolvePlantIdentity(shop, item.plantName, options);
    // Conditional, so a request loading concurrently cannot have its own
    // resolution overwritten by this sweep.
    const { count } = await prisma.requestItem.updateMany({
      where: { id: item.id, canonicalPlantId: null },
      data: { canonicalPlantId: identity.canonicalPlantId },
    });
    resolved += count;
  }
  return resolved;
}

/** Assigns an identity to the lines of one request, without sweeping the shop. */
export async function assignCanonicalPlantsForRequest(
  shop: string,
  requestId: string,
  options: ResolveOptions = {},
): Promise<void> {
  const items = await prisma.requestItem.findMany({
    where: { requestId, canonicalPlantId: null, request: { shop } },
    select: { id: true, plantName: true },
    orderBy: ITEM_ORDER,
  });
  for (const item of items) {
    const identity = await resolvePlantIdentity(shop, item.plantName, options);
    await prisma.requestItem.updateMany({
      where: { id: item.id, canonicalPlantId: null },
      data: { canonicalPlantId: identity.canonicalPlantId },
    });
  }
}

/**
 * The customer spellings counted under each identity, so the owner can see what
 * a row on the plant tables is actually made of.
 */
export async function canonicalPlantVariants(
  shop: string,
): Promise<Map<string, string[]>> {
  const aliases = await prisma.plantNameAlias.findMany({
    where: { shop },
    select: { canonicalPlantId: true, originalName: true },
    orderBy: { createdAt: "asc" },
  });

  const variants = new Map<string, string[]>();
  for (const alias of aliases) {
    const current = variants.get(alias.canonicalPlantId) ?? [];
    const name = alias.originalName.trim();
    if (name && !current.includes(name)) current.push(name);
    variants.set(alias.canonicalPlantId, current);
  }
  return variants;
}

export { canonicalPlantKey };
