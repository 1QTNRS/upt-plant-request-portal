import type { ActionFunctionArgs } from "react-router";

import {
  handleCustomerDataRequest,
  type CompliancePayload,
} from "../lib/compliance.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const exports = await handleCustomerDataRequest(
    shop,
    payload as CompliancePayload,
  );
  console.log(
    `Handled ${topic} for ${shop}: ${exports.length} customer record(s) collected.`,
  );
  return new Response();
};
