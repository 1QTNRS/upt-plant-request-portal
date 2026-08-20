import type { ActionFunctionArgs } from "react-router";

import { redactCustomerData } from "../lib/privacy.server";
import { authenticate } from "../shopify.server";

type RedactPayload = {
  customer?: { id?: number | string; email?: string };
};

/** Mandatory Shopify compliance webhook: erase a shopper's portal data. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as RedactPayload;

  const result = await redactCustomerData(shop, {
    shopifyCustomerId: body.customer?.id ? String(body.customer.id) : null,
    email: body.customer?.email ?? null,
  });

  console.log(
    `Received ${topic} webhook for ${shop}: removed ${result.requestsDeleted} request(s) and ${result.profilesDeleted} profile(s)`,
  );

  return new Response();
};
