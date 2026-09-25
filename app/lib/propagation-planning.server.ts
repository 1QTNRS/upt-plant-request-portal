import prisma from "../db.server";
import {
  buildPropagationCategories,
  buildPropagationGroups,
  customerIdentityKey,
  filterPropagationGroups,
  parsePropagationGroupKey,
  propagationGroupKeyForItem,
  sortPropagationCategoryPlants,
  summarizePropagationCategories,
  type PropagationDateRange,
  type PropagationPlanningCategory,
  type PropagationPlanningStateRow,
  type PropagationSort,
  type PropagationStatusFilter,
  type RawPropagationOccurrence,
} from "./propagation-planning";

export type PropagationPlanningPayload = {
  summary: ReturnType<typeof summarizePropagationCategories>;
  categories: PropagationPlanningCategory[];
  filters: {
    status: PropagationStatusFilter;
    dateRange: PropagationDateRange;
    sort: PropagationSort;
    q: string;
  };
};

function parseStatusFilter(value: string | null): PropagationStatusFilter {
  if (value === "done" || value === "all") return value;
  return "needs";
}

function parseDateRange(value: string | null): PropagationDateRange {
  if (value === "90d" || value === "30d") return value;
  return "all";
}

function parseSort(value: string | null): PropagationSort {
  if (value === "oldest_request" || value === "az") return value;
  if (value === "most_recent") return "oldest_request";
  return "most_requested";
}

async function loadAliasToCanonical(shop: string): Promise<Map<string, string>> {
  const rows = await prisma.plantNameAlias.findMany({
    where: { shop },
    select: { aliasKey: true, canonicalPlantId: true },
  });
  return new Map(rows.map((row) => [row.aliasKey, row.canonicalPlantId]));
}

async function loadCanonicalNames(shop: string): Promise<Map<string, string>> {
  const rows = await prisma.canonicalPlant.findMany({
    where: { shop },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

async function loadOccurrences(shop: string): Promise<RawPropagationOccurrence[]> {
  const rows = await prisma.offerItem.findMany({
    where: {
      availability: "not_available",
      offer: { request: { shop } },
    },
    select: {
      id: true,
      plantName: true,
      unavailableReason: true,
      customerFacingNotes: true,
      offer: {
        select: {
          sentAt: true,
          request: {
            select: {
              id: true,
              requestNumber: true,
              submittedAt: true,
              customerEmail: true,
              shopifyCustomerId: true,
            },
          },
        },
      },
      requestItem: {
        select: {
          plantName: true,
          customerRequestNotes: true,
          canonicalPlantId: true,
          canonicalPlant: { select: { displayName: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    offerItemId: row.id,
    requestId: row.offer.request.id,
    requestNumber: row.offer.request.requestNumber,
    submittedAtIso: row.offer.request.submittedAt.toISOString(),
    offerSentAtIso: row.offer.sentAt.toISOString(),
    plantName: row.plantName,
    unavailableReason: row.unavailableReason,
    customerFacingNotes: row.customerFacingNotes,
    customerRequestNotes: row.requestItem.customerRequestNotes,
    customerKey: customerIdentityKey({
      shopifyCustomerId: row.offer.request.shopifyCustomerId,
      customerEmail: row.offer.request.customerEmail,
    }),
    canonicalPlantId: row.requestItem.canonicalPlantId,
    canonicalDisplayName: row.requestItem.canonicalPlant?.displayName ?? null,
  }));
}

async function loadPlanningStates(shop: string): Promise<PropagationPlanningStateRow[]> {
  const rows = await prisma.propagationPlanningState.findMany({
    where: { shop },
    select: {
      groupKey: true,
      completedAt: true,
      propNotes: true,
      updatedAt: true,
    },
  });
  return rows;
}

export async function listPropagationPlanning(
  shop: string,
  searchParams: URLSearchParams,
): Promise<PropagationPlanningPayload> {
  const status = parseStatusFilter(searchParams.get("status"));
  const dateRange = parseDateRange(searchParams.get("dateRange"));
  const sort = parseSort(searchParams.get("sort"));
  const q = searchParams.get("q")?.trim() ?? "";

  const [occurrences, aliasToCanonical, canonicalNames, planningStates] =
    await Promise.all([
      loadOccurrences(shop),
      loadAliasToCanonical(shop),
      loadCanonicalNames(shop),
      loadPlanningStates(shop),
    ]);

  const built = buildPropagationGroups({
    occurrences,
    aliasToCanonical,
    canonicalNames,
    planningStates,
    dateRange,
  });

  const filteredGroups = filterPropagationGroups(built, status, q);
  const categories = sortPropagationCategoryPlants(
    buildPropagationCategories(filteredGroups),
    sort,
  );
  const inRangeCount = built.reduce((sum, group) => sum + group.occurrenceCount, 0);

  return {
    summary: summarizePropagationCategories(built, inRangeCount),
    categories,
    filters: { status, dateRange, sort, q },
  };
}

export async function shopHasPropagationGroup(
  shop: string,
  groupKey: string,
): Promise<boolean> {
  const parsed = parsePropagationGroupKey(groupKey);
  if (!parsed) return false;

  const [occurrences, aliasToCanonical] = await Promise.all([
    loadOccurrences(shop),
    loadAliasToCanonical(shop),
  ]);
  const groups = buildPropagationGroups({
    occurrences,
    aliasToCanonical,
    canonicalNames: new Map(),
    planningStates: [],
    dateRange: "all",
  });
  return groups.some((group) => group.groupKey === groupKey);
}

export async function setPropagationPlanningDone(
  shop: string,
  groupKey: string,
  done: boolean,
): Promise<PropagationPlanningStateRow> {
  const valid = await shopHasPropagationGroup(shop, groupKey);
  if (!valid) {
    throw new Error("Unknown propagation planning group.");
  }

  const row = await prisma.propagationPlanningState.upsert({
    where: { shop_groupKey: { shop, groupKey } },
    create: {
      shop,
      groupKey,
      completedAt: done ? new Date() : null,
      propNotes: "",
    },
    update: {
      completedAt: done ? new Date() : null,
    },
    select: {
      groupKey: true,
      completedAt: true,
      propNotes: true,
      updatedAt: true,
    },
  });

  if (!done && !row.propNotes.trim()) {
    await prisma.propagationPlanningState.deleteMany({
      where: { shop, groupKey, completedAt: null, propNotes: "" },
    });
  }

  return row;
}

export async function savePropagationPlanningNotes(
  shop: string,
  groupKey: string,
  propNotes: string,
): Promise<PropagationPlanningStateRow> {
  const valid = await shopHasPropagationGroup(shop, groupKey);
  if (!valid) {
    throw new Error("Unknown propagation planning group.");
  }

  const trimmed = propNotes.trim();
  const existing = await prisma.propagationPlanningState.findUnique({
    where: { shop_groupKey: { shop, groupKey } },
  });

  if (!trimmed && !existing?.completedAt) {
    if (existing) {
      await prisma.propagationPlanningState.delete({
        where: { shop_groupKey: { shop, groupKey } },
      });
    }
    return {
      groupKey,
      completedAt: null,
      propNotes: "",
      updatedAt: new Date(),
    };
  }

  return prisma.propagationPlanningState.upsert({
    where: { shop_groupKey: { shop, groupKey } },
    create: {
      shop,
      groupKey,
      propNotes: trimmed,
      completedAt: existing?.completedAt ?? null,
    },
    update: { propNotes: trimmed },
    select: {
      groupKey: true,
      completedAt: true,
      propNotes: true,
      updatedAt: true,
    },
  });
}

export { propagationGroupKeyForItem };
