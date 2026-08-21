import type { PlantLine } from "../components/customer-request-portal";
import { customerPortalRelativeLinks } from "./app-proxy";

/**
 * Pure parts of the customer portal: how many plant rows a form has, and where
 * it posts to. Kept out of `customer-portal.server.ts` so they can be tested
 * without pulling in the Shopify app instance.
 */

export const MAX_PLANT_ROWS = 20;

/** Anything longer than this is a paste accident, and it has to fit in a URL. */
export const MAX_NOTE_LENGTH = 500;
export const MAX_PLANT_NAME_LENGTH = 120;

type FieldSource = Pick<FormData, "get">;

/** Reads the plant rows out of a form or a query string, preserving the input. */
export function readPlantLines(fields: FieldSource): PlantLine[] {
  const declared = Number(fields.get("itemCount") || 1) || 1;
  const count = Math.max(1, Math.min(declared, MAX_PLANT_ROWS));
  const lines: PlantLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      plantName: String(fields.get(`plantName-${index}`) ?? "").slice(
        0,
        MAX_PLANT_NAME_LENGTH,
      ),
      notes: String(fields.get(`notes-${index}`) ?? "").slice(0, MAX_NOTE_LENGTH),
    });
  }
  return lines;
}

/**
 * The rows to render, taken from the query string that the add and remove
 * buttons navigate to.
 *
 * Those buttons submit the form with GET rather than POST: a GET is the same
 * request shape as the page load the storefront already serves, and the browser
 * puts everything the customer typed into the query string for us.
 */
export function plantLinesFromQuery(search: URLSearchParams): PlantLine[] | null {
  const adding = search.has("addPlant");
  const removing = search.get("removePlant");
  if (!adding && removing === null) return null;

  const submitted = readPlantLines(search);
  if (adding) return withExtraRow(submitted);

  const index = Number(removing);
  if (!Number.isInteger(index) || index < 0) return submitted;
  return withoutRow(submitted, index);
}

export function withExtraRow(lines: PlantLine[]): PlantLine[] {
  if (lines.length >= MAX_PLANT_ROWS) return lines;
  return [...lines, { plantName: "", notes: "" }];
}

export function withoutRow(lines: PlantLine[], index: number): PlantLine[] {
  const remaining = lines.filter((_line, position) => position !== index);
  return remaining.length > 0 ? remaining : [{ plantName: "", notes: "" }];
}

/**
 * Where the portal's form posts to.
 *
 * Deliberately a real path rather than React Router's `?index` convention:
 * React Router strips `index` from the request URL before a loader sees it, so
 * Shopify would sign a query string containing `index` that the app then
 * verifies without it, and every proxied submission would fail its HMAC check.
 */
export function portalFormAction(context: { viaAppProxy: boolean }): string {
  return `${portalHome(context)}/submit`;
}

/** The page the customer returns to, always on the storefront under the proxy. */
export function portalHome(context: { viaAppProxy: boolean }): string {
  return customerPortalRelativeLinks(context.viaAppProxy).home;
}

/**
 * The accept/reject choices in a submitted offer form, keyed by request item.
 *
 * Read from `choice-<sourceItemId>` radios rather than a hidden mirror of React
 * state, so the values are whatever the customer actually selected even when the
 * page has not hydrated. Only `accept` and `reject` are honoured; an item the
 * shop marked unavailable is informational and carries no control.
 */
export function readOfferChoices(
  form: FormData,
): Record<string, "accept" | "reject"> {
  const choices: Record<string, "accept" | "reject"> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("choice-")) continue;
    if (value !== "accept" && value !== "reject") continue;
    choices[key.slice("choice-".length)] = value;
  }
  return choices;
}
