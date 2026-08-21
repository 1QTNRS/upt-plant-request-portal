import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import { listExactPlantCandidates } from "../lib/exact-plants.server";
import { EXACT_PLANT_RELEASE_LABELS } from "../lib/exact-plants";
import { formatCurrency } from "../lib/portal";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const items = await listExactPlantCandidates(shop);
  return { items };
};

export default function ExactPlantsIndex() {
  const { items } = useLoaderData<typeof loader>();

  return (
    <s-page heading="EXACT PLANTS">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <s-section>
        <s-text color="subdued">
          Exact plants UPT marked Available and offered to a customer, whose hold
          has ended: the customer declined, or the offer expired unpaid. Nothing
          is published to Shopify until you review and approve a listing. Not
          Available, never-offered, paid and FedEx items are excluded.
        </s-text>
      </s-section>
      <s-section heading="Exact plants released for listing">
        {items.length === 0 ? (
          <s-text color="subdued">
            No exact plants are waiting for an EXACT PLANTS listing.
          </s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {items.map((item) => {
              const listed =
                item.listing?.status === "listed" && item.listing.shopifyProductGid;
              const reviewHref = `/app/exact-plants/${item.requestItemId}?returnTo=/app/exact-plants`;
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
                      <s-badge>{EXACT_PLANT_RELEASE_LABELS[item.releaseReason]}</s-badge>
                      <s-text color="subdued">{item.requestNumber}</s-text>
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
                      <s-link href={reviewHref}>Create EXACT PLANTS Listing</s-link>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
