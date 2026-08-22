import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  canDismissExactPlantFromQueue,
  EXACT_PLANT_RELEASE_LABELS,
  exactPlantReleaseTone,
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
  return { items };
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
  const { items } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

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
          Available, never-offered, paid and FedEx items are excluded. Dismiss
          from EXACT PLANTS removes an item from this queue without creating a
          product.
        </s-text>
      </s-section>
      {actionData?.error ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        </s-section>
      ) : null}
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
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
