import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  CollapsibleSection,
  CollapsibleSectionStyles,
} from "../components/collapsible-section";
import { requireAdmin } from "../lib/admin-auth.server";
import { ExactPlantsTable } from "../components/exact-plants-table";
import {
  countExactPlantListingFilters,
  EXACT_PLANT_LISTING_FILTER_LABELS,
  EXACT_PLANT_LISTING_FILTERS,
  matchesExactPlantListingFilter,
  parseExactPlantListingFilter,
  parseExactPlantTableSortState,
  sortExactPlantTable,
} from "../lib/exact-plants";
import {
  createExactPlantListingsFromDrafts,
  dismissExactPlantFromQueue,
  dismissExactPlantsFromQueue,
  listDismissedExactPlants,
  listExactPlantCandidates,
} from "../lib/exact-plants.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const items = await listExactPlantCandidates(shop);
  const dismissed = await listDismissedExactPlants(shop);
  const search = new URL(request.url).searchParams;
  const listingFilter = parseExactPlantListingFilter(search.get("listing"));
  const sort = parseExactPlantTableSortState(search);
  const counts = {
    ...countExactPlantListingFilters(items),
    dismissed: dismissed.length,
  };
  const visible = sortExactPlantTable(
    listingFilter === "dismissed"
      ? dismissed
      : items.filter((item) => matchesExactPlantListingFilter(item, listingFilter)),
    sort,
  );
  return {
    items: visible,
    listingFilter,
    sort,
    counts,
    total: items.length,
    dismissedCount: dismissed.length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "bulk-create-listings") {
    const requestItemIds = form
      .getAll("requestItemId")
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (requestItemIds.length === 0) {
      return {
        error: "Select at least one plant to list.",
        pendingDismissItemId: null as string | null,
        bulkMessage: null as string | null,
      };
    }
    const result = await createExactPlantListingsFromDrafts(
      admin,
      shop,
      requestItemIds,
    );
    if (result.created === 0 && result.errors.length > 0) {
      return {
        error: result.errors.map((entry) => entry.error).join(" "),
        pendingDismissItemId: null,
        bulkMessage: null,
      };
    }
    const parts = [
      result.created === 1
        ? "Created 1 listing."
        : `Created ${result.created} listings.`,
    ];
    if (result.skipped > 0) {
      parts.push(
        result.skipped === 1
          ? "Skipped 1 already-listed plant."
          : `Skipped ${result.skipped} already-listed plants.`,
      );
    }
    if (result.errors.length > 0) {
      parts.push(result.errors.map((entry) => entry.error).join(" "));
    }
    return {
      error: result.errors.length > 0 ? parts.join(" ") : null,
      pendingDismissItemId: null,
      bulkMessage: result.errors.length > 0 ? null : parts.join(" "),
    };
  }

  if (intent === "bulk-dismiss-exact-plants") {
    const requestItemIds = form
      .getAll("requestItemId")
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (requestItemIds.length === 0) {
      return {
        error: "Select at least one plant to dismiss.",
        pendingDismissItemId: null as string | null,
        bulkMessage: null as string | null,
      };
    }
    const result = await dismissExactPlantsFromQueue({
      shop,
      requestItemIds,
      confirmed: String(form.get("confirmed")) === "true",
    });
    if (result.dismissed === 0 && result.errors.length > 0) {
      return {
        error: result.errors.map((entry) => entry.error).join(" "),
        pendingDismissItemId: null,
        bulkMessage: null,
      };
    }
    const parts = [
      result.dismissed === 1
        ? "Dismissed 1 plant."
        : `Dismissed ${result.dismissed} plants.`,
    ];
    if (result.skipped > 0) {
      parts.push(
        result.skipped === 1
          ? "Skipped 1 already-dismissed plant."
          : `Skipped ${result.skipped} already-dismissed plants.`,
      );
    }
    if (result.errors.length > 0) {
      parts.push(result.errors.map((entry) => entry.error).join(" "));
    }
    return {
      error: result.errors.length > 0 ? parts.join(" ") : null,
      pendingDismissItemId: null,
      bulkMessage: result.errors.length > 0 ? null : parts.join(" "),
    };
  }

  if (intent !== "dismiss-exact-plant") {
    return {
      error: "Unknown action.",
      pendingDismissItemId: null as string | null,
      bulkMessage: null as string | null,
    };
  }

  const requestItemId = String(form.get("requestItemId") || "");
  const result = await dismissExactPlantFromQueue({
    shop,
    requestItemId,
    confirmed: String(form.get("confirmed")) === "true",
  });
  if (!result.ok) {
    return {
      error: result.error,
      pendingDismissItemId: result.pendingDismiss ? requestItemId : null,
      bulkMessage: null,
    };
  }
  return {
    error: null as string | null,
    pendingDismissItemId: null as string | null,
    bulkMessage: null as string | null,
  };
};

export default function ExactPlantsIndex() {
  const { items, listingFilter, sort, counts, total } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="EXACT PLANTS">
      <CollapsibleSectionStyles />
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <s-section>
        <s-text color="subdued">
          Unclaimed exact plants whose hold has ended: the customer declined,
          the offer expired unpaid, or the request closed with the plant still
          unclaimed. Nothing is published to Shopify until you review and
          approve a listing. Not Available, never-offered, paid and FedEx items
          are excluded. Dismiss from EXACT PLANTS removes an item from this
          queue without creating a product. Dismissed plants stay on the
          Dismissed tab and cannot be listed.
        </s-text>
      </s-section>
      {actionData?.error ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        </s-section>
      ) : null}
      {actionData?.bulkMessage ? (
        <s-section>
          <s-banner tone="success">
            <s-text>{actionData.bulkMessage}</s-text>
          </s-banner>
        </s-section>
      ) : null}
      <s-section>
        <CollapsibleSection
          title="EXACT PLANTS queue"
          badge={total}
          defaultOpen={true}
        >
          <Form method="get" data-exact-plant-listing-filter>
            <input type="hidden" name="sort" value={sort.column} />
            <input type="hidden" name="dir" value={sort.direction} />
            <s-stack direction="inline" gap="small">
              {EXACT_PLANT_LISTING_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="submit"
                  name="listing"
                  value={filter}
                  aria-pressed={listingFilter === filter}
                  style={{
                    padding: "8px 12px",
                    minHeight: 44,
                    borderRadius: 8,
                    border: "1px solid #c9cccf",
                    background: listingFilter === filter ? "#008060" : "#fff",
                    color: listingFilter === filter ? "#fff" : "inherit",
                    font: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {EXACT_PLANT_LISTING_FILTER_LABELS[filter]} ({counts[filter]})
                </button>
              ))}
            </s-stack>
          </Form>
          {items.length === 0 ? (
            <s-text color="subdued">
              No exact plants match this filter.
            </s-text>
          ) : (
            <ExactPlantsTable
              items={items}
              listingFilter={listingFilter}
              sort={sort}
              mode={listingFilter === "dismissed" ? "dismissed" : "queue"}
            />
          )}
        </CollapsibleSection>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
