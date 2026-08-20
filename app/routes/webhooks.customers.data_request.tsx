import type { ActionFunctionArgs } from "react-router";

import { exportCustomerData } from "../lib/privacy.server";
import { authenticate } from "../shopify.server";

type DataRequestPayload = {
  customer?: { id?: number | string; email?: string };
  data_request?: { id?: number | string };
};

/**
 * Mandatory Shopify compliance webhook. Shopify requires the app to make the
 * shopper's stored data available to the merchant, who forwards it on.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as DataRequestPayload;

  const exported = await exportCustomerData(shop, {
    shopifyCustomerId: body.customer?.id ? String(body.customer.id) : null,
    email: body.customer?.email ?? null,
  });

  console.log(
    `Received ${topic} webhook for ${shop}`,
    JSON.stringify({
      dataRequestId: body.data_request?.id ?? null,
      customerId: body.customer?.id ?? null,
      requestsFound: exported[0]?.requests.length ?? 0,
      data: exported,
    }),
  );

  return new Response();
};
