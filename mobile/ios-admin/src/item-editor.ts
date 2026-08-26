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
