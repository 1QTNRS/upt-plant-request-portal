import type { PlantLine } from "../components/customer-request-portal";
import { customerPortalLinks, customerPortalRelativeLinks } from "./app-proxy";

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
 * Where a proxied POST may redirect to. Absolute, unlike `portalHome`.
 *
 * Shopify follows 30x responses from the proxy itself rather than handing them
 * to the browser, and it resolves the `Location` against the app's own origin.
 * A storefront-relative `/apps/plant-requests` therefore becomes
 * `https://<app-host>/apps/plant-requests`, which the app does not serve, and
 * the submission dies after the request was already saved. The absolute
 * storefront URL is correct whether Shopify follows the redirect or passes it
 * to the browser.
 */
export function portalRedirectTarget(context: {
  viaAppProxy: boolean;
  shop: string;
}): string {
  if (!context.viaAppProxy) return portalHome(context);
  return customerPortalLinks({ shop: context.shop, viaAppProxy: true }).home;
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

/**
 * Whether unticking the FedEx upgrade has to be confirmed against the Settings
 * warning before the answer is recorded.
 *
 * The warning is about how accepted plants ship. A customer who accepted
 * nothing is shipping nothing, so making them acknowledge a disclaimer — or
 * untick a box they were never going to be charged for — is a round trip about
 * a charge that will not happen. The response records the upgrade as unselected
 * in that case either way.
 */
export function fedexRemovalNeedsConfirmation(input: {
  choices: Record<string, "accept" | "reject">;
  fedexSelected: boolean;
  acknowledged: boolean;
}): boolean {
  if (input.fedexSelected || input.acknowledged) return false;
  return Object.values(input.choices).includes("accept");
}

/**
 * How the FedEx checkbox should look as the customer toggles Accept / Reject.
 *
 * Zero accepted purchasable plants: unchecked, disabled, no removal warning.
 * Crossing from zero to one or more: checked and enabled again. While at least
 * one plant stays accepted, a manual uncheck is left alone so the Settings
 * warning can still run.
 */
export function fedexUpgradeUiState(input: {
  acceptedPurchasableCount: number;
  previousAcceptedCount: number;
  currentlyChecked: boolean;
}): {
  enabled: boolean;
  checked: boolean;
  showRemovalWarning: boolean;
  autoChecked: boolean;
} {
  const enabled = input.acceptedPurchasableCount > 0;
  if (!enabled) {
    return {
      enabled: false,
      checked: false,
      showRemovalWarning: false,
      autoChecked: false,
    };
  }
  const autoChecked =
    input.previousAcceptedCount === 0 && input.acceptedPurchasableCount > 0;
  return {
    enabled: true,
    checked: autoChecked ? true : input.currentlyChecked,
    showRemovalWarning: false,
    autoChecked,
  };
}

export function countAcceptedPurchasableChoices(
  choices: Record<string, "accept" | "reject">,
): number {
  return Object.values(choices).filter((choice) => choice === "accept").length;
}

/**
 * Whether every purchasable plant on the offer was rejected (or there were
 * none to accept). Used by the customer Close Request gate.
 */
export function declinedAllPurchasableItems(input: {
  offerItems: Array<{ availability?: string; sourceItemId?: string; id?: string }>;
  responseItems?: Array<{ sourceItemId: string; choice: string }> | null;
}): boolean {
  const purchasable = input.offerItems.filter(
    (item) => (item.availability ?? "available") === "available",
  );
  if (purchasable.length === 0) return true;
  if (!input.responseItems) return false;
  return purchasable.every((item) => {
    const id = item.sourceItemId ?? item.id;
    const choice = input.responseItems!.find(
      (entry) => entry.sourceItemId === id,
    )?.choice;
    return choice === "reject";
  });
}

/**
 * Customer Close Request is only for a submitted decline-all (or
 * all-unavailable) answer that reached No Payment Needed.
 *
 * Reviewing the offer with nothing selected yet is not enough, and an accepted
 * plant — or anything still payable — must stay open until paid, expired, or
 * closed by admin override.
 */
export function customerCanCloseRequest(input: {
  requestClosed: boolean;
  hasResponded: boolean;
  hasPayableItems?: boolean;
  acceptedCount: number;
  declinedAllAvailable: boolean;
}): boolean {
  if (input.requestClosed) return false;
  if (!input.hasResponded) return false;
  if (input.hasPayableItems !== false) return false;
  if (input.acceptedCount > 0) return false;
  if (!input.declinedAllAvailable) return false;
  return true;
}
