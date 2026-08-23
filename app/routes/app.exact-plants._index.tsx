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
import {
  canDismissExactPlantFromQueue,
  countExactPlantListingFilters,
  EXACT_PLANT_LISTING_FILTER_LABELS,
  EXACT_PLANT_LISTING_FILTERS,
  EXACT_PLANT_RELEASE_LABELS,
  exactPlantReleaseTone,
  matchesExactPlantListingFilter,
  parseExactPlantListingFilter,
} from "../lib/exact-plants";
import {
  dismissExactPlantFromQueue,
  listExactPlantCandidates,
} from "../lib/exact-plants.server";
import { formatCurrency } from "../lib/portal";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const items = await listExactPlantCandidates(shop);
  const listingFilter = parseExactPlantListingFilter(
    new URL(request.url).searchParams.get("listing"),
  );
  const counts = countExactPlantListingFilters(items);
  const visible = items.filter((item) =>
    matchesExactPlantListingFilter(item, listingFilter),
  );
  return { items: visible, listingFilter, counts, total: items.length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "dismiss-exact-plant") {
    return { error: "Unknown action.", pendingDismissItemId: null as string | null };
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
    };
  }
  return { error: null as string | null, pendingDismissItemId: null as string | null };
};

export default function ExactPlantsIndex() {
  const { items, listingFilter, counts, total } = useLoaderData<typeof loader>();
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
          queue without creating a product.
        </s-text>
      </s-section>
      {actionData?.error ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        </s-section>
      ) : null}
      <s-section>
        <CollapsibleSection
          title="EXACT PLANTS queue"
          badge={total}
          defaultOpen={total > 0}
        >
          <Form method="get" data-exact-plant-listing-filter>
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
            <s-stack direction="block" gap="base">
              {items.map((item) => {
                const listed =
                  item.listing?.status === "listed" && item.listing.shopifyProductGid;
                const reviewHref = `/app/exact-plants/${item.requestItemId}?returnTo=/app/exact-plants`;
                const canDismiss = canDismissExactPlantFromQueue({
                  listing: item.listing,
                });
                const confirming = actionData?.pendingDismissItemId === item.requestItemId;
                return (
                  <s-box
                    key={item.requestItemId}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="small">
                      <s-heading>{item.title}</s-heading>
                      <s-stack direction="inline" gap="small">
                        <s-badge tone={exactPlantReleaseTone(item.releaseReason)}>
                          {EXACT_PLANT_RELEASE_LABELS[item.releaseReason]}
                        </s-badge>
                        <s-link href={`/app/requests/${item.requestId}`}>
                          Request {item.requestNumber}
                        </s-link>
                      </s-stack>
                      <s-text>
                        {formatCurrency(item.price)} · {item.weightLbs} lb
                      </s-text>
                      {item.listing?.status === "failed" && item.listing.lastError ? (
                        <s-banner tone="critical">
                          <s-text>{item.listing.lastError}</s-text>
                        </s-banner>
                      ) : null}
                      {item.listing?.status === "failed" &&
                      item.listing.productAdminUrl ? (
                        <s-link href={item.listing.productAdminUrl} target="_blank">
                          Open the unpublished Shopify product this attempt created
                        </s-link>
                      ) : null}
                      {listed ? (
                        <s-stack direction="inline" gap="base">
                          <s-badge tone="success">Listed in EXACT PLANTS</s-badge>
                          {item.listing?.productAdminUrl ? (
                            <s-link href={item.listing.productAdminUrl} target="_blank">
                              Open Shopify product
                            </s-link>
                          ) : null}
                        </s-stack>
                      ) : (
                        <s-stack direction="inline" gap="base">
                          <s-link href={reviewHref}>Create EXACT PLANTS Listing</s-link>
                          {canDismiss ? (
                            confirming ? (
                              <Form method="post">
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="dismiss-exact-plant"
                                />
                                <input
                                  type="hidden"
                                  name="requestItemId"
                                  value={item.requestItemId}
                                />
                                <input type="hidden" name="confirmed" value="true" />
                                <s-button variant="primary" tone="critical" type="submit">
                                  Confirm Dismiss from EXACT PLANTS
                                </s-button>
                              </Form>
                            ) : (
                              <Form method="post">
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="dismiss-exact-plant"
                                />
                                <input
                                  type="hidden"
                                  name="requestItemId"
                                  value={item.requestItemId}
                                />
                                <s-button variant="secondary" type="submit">
                                  Dismiss from EXACT PLANTS
                                </s-button>
                              </Form>
                            )
                          ) : null}
                        </s-stack>
                      )}
                      {confirming ? (
                        <s-banner tone="warning">
                          <s-text>
                            This removes the plant from the EXACT PLANTS queue. No
                            Shopify product is created. The original request,
                            customer response, offer snapshot, photos, and history
                            stay.
                          </s-text>
                        </s-banner>
                      ) : null}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}
        </CollapsibleSection>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
