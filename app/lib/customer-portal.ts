import type { PlantLine } from "../components/customer-request-portal";
import { customerPortalRelativeLinks } from "./app-proxy";

/**
 * Pure parts of the customer portal: how many plant rows a form has, and where
 * it posts to. Kept out of `customer-portal.server.ts` so they can be tested
 * without pulling in the Shopify app instance.
 */

export const MAX_PLANT_ROWS = 20;

/** Reads the plant rows out of a submitted form, preserving what was typed. */
export function readPlantLines(form: FormData): PlantLine[] {
  const declared = Number(form.get("itemCount") || 1) || 1;
  const count = Math.max(1, Math.min(declared, MAX_PLANT_ROWS));
  const lines: PlantLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      plantName: String(form.get(`plantName-${index}`) ?? ""),
      notes: String(form.get(`notes-${index}`) ?? ""),
    });
  }
  return lines;
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
