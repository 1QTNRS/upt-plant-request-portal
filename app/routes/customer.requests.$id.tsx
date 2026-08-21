import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";

import { CustomerOfferView } from "../components/customer-offer-view";
import { customerPortalRelativeLinks } from "../lib/app-proxy";
import { readCustomerContext } from "../lib/customer-session.server";
import { resolveCustomerIdentity } from "../lib/customer-identity.server";
import { identityOwnsRequest } from "../lib/customer-identity";
import {
  formatCustomerStatusLabel,
  getDisplayRequestNumber,
  requestStatusTone,
} from "../lib/portal";
import {
  handleCustomerOfferAction,
  loadCustomerOfferPage,
} from "../lib/offer-response.server";
import { getRequest } from "../lib/portal.server";
import { offlineAdminClient } from "../lib/offline-admin.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";


/**
 * Resolves the visitor and confirms they own the request, or returns null so
 * the caller can render the same "not available" response for a missing
 * request, a forged id and someone else's request.
 */
async function authorizeRequest(request: Request, requestId: string) {
  const context = await readCustomerContext(request);
  if (!context) return null;

  // Never seeds a real shop; keeps the settings row present for one.
  await ensureShopSeeded(context.shop);

  if (!context.identity) return null;
  const identity = await resolveCustomerIdentity(context.shop, context.identity);
  const plantRequest = await getRequest(context.shop, requestId);
  if (!identityOwnsRequest(identity, plantRequest)) return null;

  return { context, plantRequest };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const requestId = params.id ?? "";
  const authorized = await authorizeRequest(request, requestId);

  if (!authorized) {
    return {
      forbidden: true as const,
      request: null,
      offer: null,
      response: null,
      invoiceUrl: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      confirmationEmail: null,
      backHref: customerPortalRelativeLinks(false).home,
    };
  }

  const { context, plantRequest } = authorized;
  const page = await loadCustomerOfferPage(context.shop, requestId);
  return {
    forbidden: false as const,
    request: plantRequest,
    ...page,
    backHref: customerPortalRelativeLinks(context.viaAppProxy).home,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const requestId = params.id ?? "";
  const authorized = await authorizeRequest(request, requestId);
  if (!authorized) throw data("Not found", { status: 404 });

  const { context } = authorized;
  const form = await request.formData();
  // The portal is served through the app proxy and so has no merchant session;
  // the stored offline token is what lets an accepted offer become a real
  // Shopify draft order.
  const admin = await offlineAdminClient(context.shop);
  return handleCustomerOfferAction({ shop: context.shop, requestId, form, admin });
};

export default function CustomerRequestDetail() {
  const data = useLoaderData<typeof loader>();

  if (data.forbidden) {
    return (
      <s-page heading="Request not available">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              You can only view your own plant requests. Please log in with the
              customer account that submitted this request.
            </s-text>
            <s-link href={data.backHref}>Back to My Requests</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (!data.offer && data.request) {
    return (
      <s-page heading={getDisplayRequestNumber(data.request)}>
        <s-section heading="Request details">
          <s-stack direction="block" gap="base">
            <s-badge tone={requestStatusTone(data.request.status)}>
              {formatCustomerStatusLabel(data.request.status)}
            </s-badge>
            <s-text>Submitted {data.request.submittedDate}</s-text>
            <s-text>Requested plants:</s-text>
            {data.request.items.map((item) => (
              <s-text key={item.id}>{item.plantName}</s-text>
            ))}
            <s-text color="subdued">
              We&apos;ll notify you when your personal offer is ready.
            </s-text>
            <s-link href={data.backHref}>Back to My Requests</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <CustomerOfferView
      offer={data.offer}
      response={data.response}
      invoiceUrl={data.invoiceUrl}
      fedexRemovalWarning={data.fedexRemovalWarning}
      backHref={data.backHref}
      requestClosed={data.requestClosed}
      confirmationEmail={data.confirmationEmail}
    />
  );
}
