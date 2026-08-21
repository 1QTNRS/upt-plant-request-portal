import type { ActionFunctionArgs } from "react-router";

import {
  handleCustomerRedact,
  type CompliancePayload,
} from "../lib/compliance.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const result = await handleCustomerRedact(shop, payload as CompliancePayload);
  console.log(
    `Handled ${topic} for ${shop}: deleted ${result.profilesDeleted} customer profile(s) and ${result.emailsDeleted} email(s).`,
  );
  return new Response();
};
