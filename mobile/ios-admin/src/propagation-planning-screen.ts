import type {
  PropagationPlanningCategory,
  PropagationPlanningPayload,
} from "./types";

export type PropagationPlanningPayloadWarning = {
  missingCategories: boolean;
  message: string | null;
};

export function normalizePropagationPlanningPayload(
  raw: PropagationPlanningPayload,
): { payload: PropagationPlanningPayload; warning: PropagationPlanningPayloadWarning } {
  const missingCategories = !Array.isArray(raw.categories);
  const categories: PropagationPlanningCategory[] = missingCategories
    ? []
    : raw.categories.map((category) => ({
        ...category,
        plants: Array.isArray(category.plants) ? category.plants : [],
      }));

  return {
    payload: {
      ...raw,
      categories,
    },
    warning: {
      missingCategories,
      message: missingCategories
        ? "Propagation planning API response is missing categories[]; showing an empty list until the server matches the current app contract."
        : null,
    },
  };
}

export function mergeNotesDraftsFromCategories(
  current: Record<string, string> | undefined,
  categories: PropagationPlanningCategory[],
): Record<string, string> {
  const merged = { ...(current ?? {}) };
  for (const category of categories) {
    for (const plant of category.plants) {
      if (merged[plant.groupKey] === undefined) {
        merged[plant.groupKey] = plant.state?.propNotes ?? "";
      }
    }
  }
  return merged;
}

export function appendNotesDraft(
  current: Record<string, string> | undefined,
  groupKey: string,
  value: string,
): Record<string, string> {
  return {
    ...(current ?? {}),
    [groupKey]: value,
  };
}
