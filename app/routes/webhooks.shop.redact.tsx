import type { ActionFunctionArgs } from "react-router";

import { handleShopRedact } from "../lib/compliance.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  await handleShopRedact(shop);
  console.log(`Handled ${topic} for ${shop}: all portal data erased.`);
  return new Response();
};
