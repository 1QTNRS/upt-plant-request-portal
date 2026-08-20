import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { CustomerOfferView } from "../components/customer-offer-view";
import {
  authenticateCustomer,
  identityOwnsRequest,
  readCustomerSession,
} from "../lib/customer-session.server";
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
import { ensureShopSettings } from "../lib/seed-demo.server";

const FORBIDDEN = {
  forbidden: true as const,
  request: null,
  offer: null,
  response: null,
  invoiceUrl: null,
  fedexRemovalWarning: "",
  requestClosed: false,
  confirmationEmail: null,
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await readCustomerSession(request);
  if (!session) return FORBIDDEN;

  await ensureShopSettings(session.shop);
  const requestId = params.id ?? "";
  const plantRequest = await getRequest(session.shop, requestId);

  if (!identityOwnsRequest(session, plantRequest)) return FORBIDDEN;

  const page = await loadCustomerOfferPage(session.shop, requestId);
  return { forbidden: false as const, request: plantRequest, ...page };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const authenticated = await authenticateCustomer(request);
  if (!authenticated) return { ok: false as const };

  const { identity, admin } = authenticated;
  const requestId = params.id ?? "";
  const plantRequest = await getRequest(identity.shop, requestId);
  if (!identityOwnsRequest(identity, plantRequest)) return { ok: false as const };

  const form = await request.formData();
  return handleCustomerOfferAction({
    shop: identity.shop,
    requestId,
    form,
    admin,
  });
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
