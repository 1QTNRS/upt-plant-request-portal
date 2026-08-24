import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APP_PROXY_BASE_PATH, CUSTOMER_PORTAL_PATH } from "./app-proxy";
import {
  countAcceptedPurchasableChoices,
  customerCanCloseRequest,
  declinedAllPurchasableItems,
  fedexRemovalNeedsConfirmation,
  fedexUpgradeUiState,
  plantLinesFromQuery,
  portalFormAction,
  portalHome,
  readOfferChoices,
  readPlantLines,
  withExtraRow,
  withoutRow,
} from "./customer-portal";
import { shouldRenderCustomerPortalNav } from "./customer-nav";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

function context(viaAppProxy: boolean) {
  return { viaAppProxy };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("customer portal form target", () => {
  it("posts to the storefront proxy path when served through the proxy", () => {
    assert.equal(portalFormAction(context(true)), `${APP_PROXY_BASE_PATH}/submit`);
  });

  it("posts to the app path for the local demo", () => {
    assert.equal(portalFormAction(context(false)), `${CUSTOMER_PORTAL_PATH}/submit`);
  });

  /**
   * React Router removes `index` from the request URL before a loader sees it,
   * so Shopify signs a query string containing `index` that the app then
   * verifies without it. Every proxied submission fails its HMAC check and the
   * customer is shown the signed-out page.
   */
  it("never uses React Router's ?index convention", () => {
    for (const viaAppProxy of [true, false]) {
      assert.ok(
        !portalFormAction(context(viaAppProxy)).includes("index"),
        "the app proxy signature cannot survive an ?index form action",
      );
    }
  });

  it("keeps the customer on the storefront after submitting", () => {
    assert.equal(portalHome(context(true)), APP_PROXY_BASE_PATH);
    assert.ok(!portalHome(context(true)).startsWith(CUSTOMER_PORTAL_PATH));
  });
});

describe("adding and removing rows through the query string", () => {
  /*
   * The add and remove buttons submit the form with GET rather than POST. A GET
   * is the same request shape as the page load the storefront already serves,
   * and a proxied POST to the row endpoints returned "Bad Request" on the real
   * store. The browser serializes the typed values into the query string.
   */
  const query = (params: Record<string, string>) => new URLSearchParams(params);

  it("does nothing for an ordinary page load", () => {
    assert.equal(plantLinesFromQuery(query({})), null);
    assert.equal(plantLinesFromQuery(query({ submitted: "REQ1" })), null);
  });

  it("adds a row and keeps what was typed", () => {
    assert.deepEqual(
      plantLinesFromQuery(
        query({
          itemCount: "1",
          "plantName-0": "Monstera",
          "notes-0": "variegated",
          addPlant: "1",
        }),
      ),
      [
        { plantName: "Monstera", notes: "variegated" },
        { plantName: "", notes: "" },
      ],
    );
  });

  it("removes the row that was clicked and keeps the others", () => {
    assert.deepEqual(
      plantLinesFromQuery(
        query({
          itemCount: "3",
          "plantName-0": "A",
          "plantName-1": "B",
          "plantName-2": "C",
          removePlant: "1",
        }),
      ),
      [
        { plantName: "A", notes: "" },
        { plantName: "C", notes: "" },
      ],
    );
  });

  it("removes the first row when index 0 is clicked", () => {
    // `removePlant=0` is falsy as a string; it must still be honoured.
    assert.deepEqual(
      plantLinesFromQuery(
        query({ itemCount: "2", "plantName-0": "A", "plantName-1": "B", removePlant: "0" }),
      ),
      [{ plantName: "B", notes: "" }],
    );
  });

  it("ignores a nonsense remove index rather than dropping a row", () => {
    const rows = plantLinesFromQuery(
      query({ itemCount: "2", "plantName-0": "A", "plantName-1": "B", removePlant: "x" }),
    );
    assert.equal(rows?.length, 2);
  });

  it("caps what a hand-written URL can ask for", () => {
    assert.equal(plantLinesFromQuery(query({ itemCount: "9999", addPlant: "1" }))?.length, 20);
    const long = plantLinesFromQuery(
      query({ itemCount: "1", "notes-0": "x".repeat(5000), addPlant: "1" }),
    );
    assert.equal(long?.[0].notes.length, 500);
  });
});

describe("plant rows", () => {
  it("reads a single row", () => {
    assert.deepEqual(
      readPlantLines(form({ itemCount: "1", "plantName-0": "Hoya", "notes-0": "" })),
      [{ plantName: "Hoya", notes: "" }],
    );
  });

  it("reads several rows and keeps their notes", () => {
    const lines = readPlantLines(
      form({
        itemCount: "2",
        "plantName-0": "Monstera",
        "notes-0": "variegated",
        "plantName-1": "Philodendron",
        "notes-1": "",
      }),
    );
    assert.deepEqual(lines, [
      { plantName: "Monstera", notes: "variegated" },
      { plantName: "Philodendron", notes: "" },
    ]);
  });

  it("always yields at least one row", () => {
    assert.equal(readPlantLines(form({})).length, 1);
    assert.equal(readPlantLines(form({ itemCount: "0" })).length, 1);
    assert.equal(readPlantLines(form({ itemCount: "-3" })).length, 1);
  });

  it("caps the row count a submitted form can ask for", () => {
    assert.equal(readPlantLines(form({ itemCount: "5000" })).length, 20);
  });

  it("adds a row without disturbing the typed ones", () => {
    const lines = [{ plantName: "Monstera", notes: "variegated" }];
    assert.deepEqual(withExtraRow(lines), [
      { plantName: "Monstera", notes: "variegated" },
      { plantName: "", notes: "" },
    ]);
  });

  it("stops adding rows at the cap", () => {
    const many = Array.from({ length: 20 }, () => ({ plantName: "x", notes: "" }));
    assert.equal(withExtraRow(many).length, 20);
  });

  it("removes the row that was clicked and keeps the rest", () => {
    const lines = [
      { plantName: "A", notes: "1" },
      { plantName: "B", notes: "2" },
      { plantName: "C", notes: "3" },
    ];
    assert.deepEqual(withoutRow(lines, 1), [
      { plantName: "A", notes: "1" },
      { plantName: "C", notes: "3" },
    ]);
  });

  it("never removes the last row", () => {
    assert.deepEqual(withoutRow([{ plantName: "A", notes: "" }], 0), [
      { plantName: "", notes: "" },
    ]);
  });
});

describe("offer response choices", () => {
  it("reads the accept and reject radios the customer selected", () => {
    assert.deepEqual(
      readOfferChoices(form({ "choice-item_1": "accept", "choice-item_2": "reject" })),
      { item_1: "accept", item_2: "reject" },
    );
  });

  it("ignores fields that are not choices", () => {
    assert.deepEqual(
      readOfferChoices(
        form({
          intent: "submit-response",
          fedexUpgradeSelected: "true",
          "choice-item_1": "accept",
        }),
      ),
      { item_1: "accept" },
    );
  });

  it("ignores anything that is not accept or reject", () => {
    // `unavailable` is derived from the offer, never taken from the form, so a
    // forged value cannot turn an unavailable plant into a purchasable one.
    assert.deepEqual(
      readOfferChoices(
        form({ "choice-item_1": "unavailable", "choice-item_2": "whatever" }),
      ),
      {},
    );
  });

  it("returns nothing for a form with no choices", () => {
    assert.deepEqual(readOfferChoices(form({ intent: "close-request" })), {});
  });
});

describe("confirming the FedEx removal", () => {
  it("asks for confirmation when an accepted plant loses the upgrade", () => {
    assert.equal(
      fedexRemovalNeedsConfirmation({
        choices: { item_1: "accept", item_2: "reject" },
        fedexSelected: false,
        acknowledged: false,
      }),
      true,
    );
  });

  it("does not ask again once the customer acknowledged the warning", () => {
    assert.equal(
      fedexRemovalNeedsConfirmation({
        choices: { item_1: "accept" },
        fedexSelected: false,
        acknowledged: true,
      }),
      false,
    );
  });

  it("says nothing while the customer is keeping the upgrade", () => {
    assert.equal(
      fedexRemovalNeedsConfirmation({
        choices: { item_1: "accept" },
        fedexSelected: true,
        acknowledged: false,
      }),
      false,
    );
  });

  it("never asks a customer who accepted nothing to untick it", () => {
    // Nothing ships, so there is no upgrade to remove and no disclaimer that
    // applies. Making them confirm one is a round trip about a charge that
    // will not happen.
    assert.equal(
      fedexRemovalNeedsConfirmation({
        choices: { item_1: "reject", item_2: "reject" },
        fedexSelected: false,
        acknowledged: false,
      }),
      false,
    );
    assert.equal(
      fedexRemovalNeedsConfirmation({
        choices: { item_1: "reject" },
        fedexSelected: true,
        acknowledged: false,
      }),
      false,
    );
  });
});

describe("FedEx checkbox state from accepted plant count", () => {
  it("checks and enables FedEx when one plant is accepted", () => {
    assert.deepEqual(
      fedexUpgradeUiState({
        acceptedPurchasableCount: 1,
        previousAcceptedCount: 0,
        currentlyChecked: false,
      }),
      { enabled: true, checked: true, showRemovalWarning: false, autoChecked: true },
    );
  });

  it("unchecks and disables FedEx when the last accepted plant is rejected", () => {
    assert.deepEqual(
      fedexUpgradeUiState({
        acceptedPurchasableCount: 0,
        previousAcceptedCount: 1,
        currentlyChecked: true,
      }),
      { enabled: false, checked: false, showRemovalWarning: false, autoChecked: false },
    );
  });

  it("re-checks and re-enables FedEx when a plant is accepted again", () => {
    assert.deepEqual(
      fedexUpgradeUiState({
        acceptedPurchasableCount: 1,
        previousAcceptedCount: 0,
        currentlyChecked: false,
      }),
      { enabled: true, checked: true, showRemovalWarning: false, autoChecked: true },
    );
  });

  it("does not disable FedEx while another accepted plant remains", () => {
    assert.deepEqual(
      fedexUpgradeUiState({
        acceptedPurchasableCount: 1,
        previousAcceptedCount: 2,
        currentlyChecked: true,
      }),
      { enabled: true, checked: true, showRemovalWarning: false, autoChecked: false },
    );
    assert.deepEqual(
      fedexUpgradeUiState({
        acceptedPurchasableCount: 1,
        previousAcceptedCount: 2,
        currentlyChecked: false,
      }),
      { enabled: true, checked: false, showRemovalWarning: false, autoChecked: false },
    );
  });

  it("counts accepted radios only", () => {
    assert.equal(
      countAcceptedPurchasableChoices({ a: "accept", b: "reject", c: "accept" }),
      2,
    );
    assert.equal(countAcceptedPurchasableChoices({ a: "reject" }), 0);
  });
});

describe("customer Close Request eligibility", () => {
  it("is refused before the offer response is submitted", () => {
    assert.equal(
      customerCanCloseRequest({
        requestClosed: false,
        hasResponded: false,
        hasPayableItems: false,
        acceptedCount: 0,
        declinedAllAvailable: true,
      }),
      false,
    );
  });

  it("is refused while the customer is only reviewing with zero selections", () => {
    assert.equal(
      customerCanCloseRequest({
        requestClosed: false,
        hasResponded: false,
        hasPayableItems: true,
        acceptedCount: 0,
        declinedAllAvailable: false,
      }),
      false,
    );
  });

  it("is allowed after a decline-all No Payment Needed response", () => {
    assert.equal(
      customerCanCloseRequest({
        requestClosed: false,
        hasResponded: true,
        hasPayableItems: false,
        acceptedCount: 0,
        declinedAllAvailable: true,
      }),
      true,
    );
  });

  it("is refused when payment is required or anything was accepted", () => {
    assert.equal(
      customerCanCloseRequest({
        requestClosed: false,
        hasResponded: true,
        hasPayableItems: true,
        acceptedCount: 1,
        declinedAllAvailable: false,
      }),
      false,
    );
  });

  it("is refused once the request is already Closed", () => {
    assert.equal(
      customerCanCloseRequest({
        requestClosed: true,
        hasResponded: true,
        hasPayableItems: false,
        acceptedCount: 0,
        declinedAllAvailable: true,
      }),
      false,
    );
  });

  it("treats every purchasable item rejected as decline-all", () => {
    assert.equal(
      declinedAllPurchasableItems({
        offerItems: [
          { availability: "available", id: "a" },
          { availability: "available", id: "b" },
        ],
        responseItems: [
          { sourceItemId: "a", choice: "reject" },
          { sourceItemId: "b", choice: "reject" },
        ],
      }),
      true,
    );
    assert.equal(
      declinedAllPurchasableItems({
        offerItems: [{ availability: "available", id: "a" }],
        responseItems: [{ sourceItemId: "a", choice: "accept" }],
      }),
      false,
    );
  });
});

describe("customers never see the admin Draft Order link", () => {
  it("is absent from every customer-facing request surface", () => {
    const files = [
      path.join(REPO_ROOT, "app", "components", "customer-offer-view.tsx"),
      path.join(REPO_ROOT, "app", "routes", "customer.requests.$id.tsx"),
      path.join(REPO_ROOT, "app", "routes", "customer._index.tsx"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !source.includes("Open Draft Order in Shopify"),
        `${file} must not expose the admin Draft Order control`,
      );
      assert.ok(
        !source.includes("shopifyAdminDraftOrderUrl"),
        `${file} must not build a Shopify Admin draft-order URL`,
      );
      assert.ok(
        !source.includes("admin.shopify.com/store"),
        `${file} must not hard-code a Shopify Admin draft-order URL`,
      );
    }
  });
});

describe("the offer response works without JavaScript", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "app", "components", "customer-offer-view.tsx"),
    "utf8",
  );

  it("submits accept and reject as native radios", () => {
    // Held in React state and mirrored into a hidden input, every item would
    // submit its default — accept for anything available — creating a draft
    // order for plants the customer meant to reject.
    assert.match(source, /type="radio"/);
    assert.match(source, /name=\{`choice-\$\{item\.sourceItemId\}`\}/);
    assert.match(source, /defaultChecked=\{choice === option\}/);
  });

  it("has no hidden mirror of the choices", () => {
    assert.ok(
      !/type="hidden"[\s\S]{0,120}name=\{`choice-\$\{item\.id\}`\}/.test(source),
      "a hidden mirror of client state would submit stale defaults",
    );
  });

  it("submits FedEx as a real checkbox, checked by default", () => {
    // An unchecked checkbox submits nothing, which is exactly "upgrade removed".
    assert.match(source, /type="checkbox"\s*\n\s*name="fedexUpgradeSelected"/);
    assert.match(source, /defaultChecked=\{fedexSelected\}/);
    assert.match(source, /id="fedex-upgrade-label"/);
  });

  it("keeps the removal warning as an explicit confirmation", () => {
    assert.match(source, /pendingFedexRemoval/);
    assert.match(source, /name="fedexRemovalAcknowledged"/);
    assert.match(source, /value="keep-fedex"/);
    assert.match(source, /Keep FedEx Upgrade/);
    assert.match(source, /I Understand, Remove Upgrade/);
    assert.match(source, /id="fedex-removal-dialog"/);
    assert.match(source, /role="dialog"/);
  });

  it("uses an isolated script for the immediate warning, not React state", () => {
    assert.match(source, /CustomerEnhanceScripts/);
    assert.ok(!source.includes("useState"));
    assert.ok(!source.includes("onClick"));
  });

  it("uses plain forms with an explicit action", () => {
    assert.ok(!/<Form\b/.test(source));
    for (const match of source.matchAll(/<form([^>]*)>/g)) {
      assert.match(match[1], /action=\{formAction\}/);
    }
  });

  it("pre-selects nothing, so every answer is deliberate", () => {
    // A pre-checked Accept turns an unread offer into a purchase for anyone who
    // just presses Submit.
    assert.ok(
      !/submittedChoices\?\.\[item\.sourceItemId\] \?\?\s*\n?\s*\(item\.availability === "available" \? "accept"/.test(
        source,
      ),
      "an available plant must not default to accept",
    );
    assert.match(source, /required/);
  });

  it("does not invent an answer when carrying choices through the FedEx warning", () => {
    assert.ok(
      !/name=\{`choice-\$\{item\.sourceItemId\}`\}\s*\n\s*value=\{submittedChoices\?\.\[item\.sourceItemId\] \?\? "accept"\}/.test(
        source,
      ),
    );
    assert.match(source, /\.filter\(\(item\) => submittedChoices\?\.\[item\.sourceItemId\]\)/);
  });

  it("never defaults a missing choice to accept on the server", () => {
    // `required` is a browser-only guard; the server is what actually protects
    // the customer from an unanswered plant becoming a purchase.
    const server = readFileSync(
      path.join(REPO_ROOT, "app", "lib", "offer-response.server.ts"),
      "utf8",
    );
    assert.ok(
      !server.includes('|| "accept"'),
      "a missing choice must be refused, not treated as an accept",
    );
    assert.match(server, /missingChoices/);
  });

  it("holds no React client state", () => {
    assert.ok(!source.includes("useState"));
    assert.ok(!source.includes("useEffect"));
    assert.ok(
      !source.includes("onClick"),
      "onClick does nothing on a page that never hydrates",
    );
  });

  it("ties FedEx enablement to accepted plant count in the enhance script", () => {
    const script = readFileSync(
      path.join(REPO_ROOT, "app", "components", "customer-enhance.tsx"),
      "utf8",
    );
    assert.match(script, /function acceptedCount\(\)/);
    assert.match(script, /box\.disabled = !enabled/);
    assert.match(script, /box\.checked = false/);
    assert.match(script, /previousAccepted === 0/);
    assert.match(script, /acceptedCount\(\) === 0/);
  });

  it("renders every photo the offer froze, not just the first", () => {
    // The rest used to be reachable only through a lightbox opened by onClick,
    // so on the storefront the customer never saw them.
    assert.match(source, /CustomerPhotoGallery urls=\{item\.photoUrls\}/);
    assert.ok(!/src=\{item\.photoUrl\}/.test(source));
  });
});

describe("customer portal navigation", () => {
  it("puts Home and My Requests on the local demo layout only, not the storefront", () => {
    const layout = readFileSync(
      path.join(REPO_ROOT, "app", "routes", "customer.tsx"),
      "utf8",
    );
    const nav = readFileSync(
      path.join(REPO_ROOT, "app", "components", "customer-portal-nav.tsx"),
      "utf8",
    );
    assert.match(layout, /shouldRenderCustomerPortalNav\(data\.viaAppProxy\)/);
    assert.match(layout, /CustomerPortalNav/);
    assert.match(layout, /storefrontHomeUrl/);
    assert.match(layout, /customerMyRequestsHref/);
    assert.match(nav, /data-customer-nav="home"/);
    assert.match(nav, /data-customer-nav="my-requests"/);
    assert.match(nav, /Home/);
    assert.match(nav, /My Requests/);
    assert.ok(!nav.includes("/app"), "customer nav must not expose admin routes");
    assert.ok(!layout.includes('href="/app"'));
    assert.equal(shouldRenderCustomerPortalNav(true), false);
    assert.equal(shouldRenderCustomerPortalNav(false), true);
  });
});

describe("the request form works without JavaScript", () => {
  // An app proxy page serves its assets from the shop's domain, so it never
  // hydrates. Anything that depends on React state is dead on the storefront.
  const source = readFileSync(
    path.join(REPO_ROOT, "app", "components", "customer-request-portal.tsx"),
    "utf8",
  );

  it("submits real named fields rather than React-controlled mirrors", () => {
    assert.match(source, /name=\{`plantName-\$\{index\}`\}/);
    assert.match(source, /name=\{`notes-\$\{index\}`\}/);
    assert.match(source, /defaultValue=\{line\.plantName\}/);
  });

  it("adds and removes rows with submit buttons, not onClick handlers", () => {
    assert.ok(!source.includes("onClick"), "onClick does nothing without hydration");
    assert.match(source, /name="addPlant"/);
    assert.match(source, /name="removePlant"/);
  });

  it("adds and removes rows with GET, not a proxied POST", () => {
    // A proxied POST to the row endpoints returned "Bad Request" on the real
    // store; a GET is the same request shape as the page load beside it.
    const buttons = [...source.matchAll(/<button[\s\S]*?>/g)].map((m) => m[0]);
    const rowButtons = buttons.filter((b) => /addPlant|removePlant/.test(b));
    assert.equal(rowButtons.length, 2);
    for (const button of rowButtons) {
      assert.match(button, /formMethod="get"/);
      assert.match(button, /formAction=\{browseAction\}/);
    }
  });

  it("uses a plain form, not the client router's Form", () => {
    // React Router's <Form> submits through the client router, which only knows
    // the app's own paths and would post to the shop domain's /customer.
    assert.ok(!/<Form\b/.test(source));
    assert.match(source, /<form method="post" action=\{formAction\}>/);
  });

  it("uses the current customer-facing request intro", () => {
    assert.match(
      source,
      /Your name and email are pulled from your customer account/,
    );
    assert.match(source, /Feel free\s+to request multiple plants at once/);
    assert.ok(
      !source.includes("There is no quantity field"),
      "quantity explanation was replaced with offer-review wording",
    );
  });

  it("holds no client state for the plant rows", () => {
    assert.ok(!source.includes("useState"));
    assert.ok(!source.includes("useEffect"));
  });

  it("drops title icons and keeps the pager off the request numbers", () => {
    assert.match(source, /<h2 className="upt-card-title">New request<\/h2>/);
    assert.match(source, /<h2 className="upt-card-title">Plants requested<\/h2>/);
    assert.match(source, /<h2 className="upt-card-title">My Requests<\/h2>/);
    assert.ok(
      !/<h2 className="upt-card-title">\s*<LeafIcon/.test(source),
      "section titles should be text only",
    );
    assert.match(source, /marginTop:\s*80/);
    assert.match(source, /padding-bottom:\s*32px/);
    assert.match(source, /gridTemplateColumns:\s*"1fr auto 1fr"/);
  });

  it("pages My Requests in place without an Excel export", () => {
    assert.match(source, /data-paged-list/);
    assert.match(source, /data-page-size=\{CUSTOMER_REQUEST_PAGE_SIZE\}/);
    assert.match(source, /data-paged-item/);
    assert.match(source, /\[data-paged-item\]\[hidden\]/);
    assert.ok(!source.includes("<s-table"));
    assert.match(source, /data-paged-prev/);
    assert.match(source, /data-paged-next/);
    assert.match(source, /aria-label="Previous page"/);
    assert.ok(!source.includes("data-export-excel"));
    assert.ok(!source.includes("spreadsheetHref"));
    assert.ok(!source.includes("Export to Excel"));
    assert.match(source, /type="button"/);
    assert.ok(!source.includes("?page="));
    assert.match(source, /THEME\.darkGreen/);
    assert.match(source, /upt-card/);
    assert.match(source, /StatusBadge/);
  });
});

describe("closing a request returns the customer to My Requests", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "app", "routes", "customer.requests.$id.tsx"),
    "utf8",
  );

  it("redirects a successful close to the portal home", () => {
    assert.match(source, /result\.closed/);
    assert.match(source, /throw redirect\(/);
    assert.match(source, /customerPortalRelativeLinks\(context\.viaAppProxy\)\.home/);
    assert.ok(
      !source.includes("listInternalNotes"),
      "internal notes stay off the customer route",
    );
  });
});
