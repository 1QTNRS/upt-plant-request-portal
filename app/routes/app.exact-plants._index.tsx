import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import { listDeclinedExactPlants } from "../lib/exact-plants.server";
import { formatCurrency } from "../lib/portal";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const items = await listDeclinedExactPlants(shop);
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
          Declined exact plants are plants UPT marked Available, offered to the
          customer, and the customer rejected. They are not published to Shopify
          until you review and approve a listing. Not Available, accepted,
          never-offered, and FedEx items are excluded.
        </s-text>
      </s-section>
      <s-section heading="Declined exact plants">
        {items.length === 0 ? (
          <s-text color="subdued">
            No declined exact plants are waiting for an EXACT PLANTS listing.
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
                    <s-text>
                      {formatCurrency(item.price)} · {item.weightLbs} lb
                    </s-text>
                    {item.listing?.status === "failed" && item.listing.lastError ? (
                      <s-banner tone="critical">
                        <s-text>{item.listing.lastError}</s-text>
                      </s-banner>
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
