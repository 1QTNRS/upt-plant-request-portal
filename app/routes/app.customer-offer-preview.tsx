import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CustomerOfferView } from "../components/customer-offer-view";
import { requireAdmin } from "../lib/admin-auth.server";
import { isDemoDataEnabled } from "../lib/environment.server";
import {
  handleCustomerOfferAction,
  loadCustomerOfferPage,
} from "../lib/offer-response.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const requestId = new URL(request.url).searchParams.get("requestId");
  return loadCustomerOfferPage(shop, requestId);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) return { ok: false };

  // Answering on the customer's behalf would record their accept/reject choices,
  // create a real draft order and email them a checkout link. Outside
  // development this page is a read-only preview of the customer offer.
  if (!isDemoDataEnabled(shop)) return { ok: false };

  const form = await request.formData();
  return handleCustomerOfferAction({ shop, requestId, form, admin });
};

export default function CustomerOfferPreview() {
  const data = useLoaderData<typeof loader>();

  return (
    <CustomerOfferView
      offer={data.offer}
      response={data.response}
      invoiceUrl={data.invoiceUrl}
      fedexRemovalWarning={data.fedexRemovalWarning}
      backHref="/app/customer-request-form"
      requestClosed={data.requestClosed}
      requestPaid={data.requestPaid}
      requestStatus={data.requestStatus}
      paidAt={data.paidAt}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
