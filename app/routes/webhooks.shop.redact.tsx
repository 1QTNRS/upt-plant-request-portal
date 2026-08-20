import type { ActionFunctionArgs } from "react-router";

import { redactShopData } from "../lib/privacy.server";
import { authenticate } from "../shopify.server";

/**
 * Mandatory Shopify compliance webhook. Delivered 48 hours after uninstall to
 * erase everything the app stored for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await redactShopData(shop);
  console.log(`Received ${topic} webhook for ${shop}: shop data erased`);

  return new Response();
};
