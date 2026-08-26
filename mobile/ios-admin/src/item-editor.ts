import type { FulfillmentRoute, RequestItem } from "./types";

export function routeOf(item: Pick<RequestItem, "availability" | "fulfillmentType">): FulfillmentRoute {
  if (item.availability === "not_available") return "not_available";
  return item.fulfillmentType === "growers_choice" ? "growers_choice" : "exact_plant";
}

export function routeLabel(route: FulfillmentRoute): string {
  if (route === "exact_plant") return "Exact Plant";
  if (route === "growers_choice") return "Link Stock";
  return "Not Available";
}

export function offerFieldsEnabled(route: FulfillmentRoute): boolean {
  return route !== "not_available";
}

export function showsExactPlantFields(route: FulfillmentRoute): boolean {
  return route === "exact_plant";
}

export function showsStockSearch(route: FulfillmentRoute): boolean {
  return route === "growers_choice";
}

export const THUMB_SIZE = 72;
export const THUMB_GAP = 8;
export const THUMB_PAD = 10;
export const THUMB_REMOVE_SIZE = 22;
export const TAB_BAR_CONTENT_HEIGHT = 64;

export function reorderPhotos<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function itemEditorSections(route: FulfillmentRoute): string[] {
  if (route === "growers_choice") {
    return [
      "fulfillment",
      "stock-search",
      "linked-stock",
      "customer-facing-notes",
      "autosave",
    ];
  }
  if (route === "not_available") {
    return ["fulfillment", "customer-facing-notes", "autosave", "unavailability-reasons"];
  }
  return [
    "fulfillment",
    "offered-name",
    "price",
    "weight",
    "customer-facing-notes",
    "autosave",
  ];
}

export function itemPhotos(item: RequestItem): Array<{ id: string; url: string }> {
  if (item.photos.length > 0) return item.photos;
  if (item.linkedStock?.imageUrl) {
    return [{ id: "linked-stock", url: item.linkedStock.imageUrl }];
  }
  return [];
}

export const STOCK_DROPDOWN_MAX_HEIGHT = 220;

export function stockDropdownOpen(
  focused: boolean,
  term: string,
  hasResults: boolean,
  loading: boolean,
  selectedClosed: boolean,
): boolean {
  if (selectedClosed) return false;
  if (!focused && !hasResults && !loading) return false;
  return term.trim().length > 0 || loading || hasResults;
}
