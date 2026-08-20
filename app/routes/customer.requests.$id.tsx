import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { CustomerOfferView } from "../components/customer-offer-view";
import { DEMO_SHOP } from "../lib/shop";
import { readCustomerSession } from "../lib/customer-session.server";
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
import { ensureShopSeeded } from "../lib/seed-demo.server";

function customerOwnsRequest(
  request: Awaited<ReturnType<typeof getRequest>>,
  session: { email: string; shopifyCustomerId?: string },
) {
  if (!request) return false;
  const email = session.email.trim().toLowerCase();
  if (email && request.email.trim().toLowerCase() === email) return true;
  if (
    session.shopifyCustomerId &&
    request.shopifyCustomerId &&
    session.shopifyCustomerId === request.shopifyCustomerId
  ) {
    return true;
  }
  return false;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = process.env.DEV_SHOP || DEMO_SHOP;
  await ensureShopSeeded(shop);
  const session = await readCustomerSession(request);
  const requestId = params.id ?? "";
  const plantRequest = await getRequest(shop, requestId);

  if (!session || !customerOwnsRequest(plantRequest, session)) {
    return {
      forbidden: true,
      request: null,
      offer: null,
      response: null,
      invoiceUrl: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      confirmationEmail: null,
    };
  }

  const page = await loadCustomerOfferPage(shop, requestId);
  return { forbidden: false, request: plantRequest, ...page };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shop = process.env.DEV_SHOP || DEMO_SHOP;
  const session = await readCustomerSession(request);
  const requestId = params.id ?? "";
  const plantRequest = await getRequest(shop, requestId);
  if (!session || !customerOwnsRequest(plantRequest, session)) {
    return { ok: false };
  }
  const form = await request.formData();
  return handleCustomerOfferAction({ shop, requestId, form });
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
            <s-link href="/customer">Back to My Requests</s-link>
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
            <s-link href="/customer">Back to My Requests</s-link>
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
      backHref="/customer"
      requestClosed={data.requestClosed}
      confirmationEmail={data.confirmationEmail}
    />
  );
}
