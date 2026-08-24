import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

/**
 * Shopify CLI 4.6+ will not deploy without one Events subscription.
 * This route only verifies the delivery and returns 200. Portal state
 * still comes from [webhooks], not from Events.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, handle, action: eventAction } =
    await authenticate.webhook(request);
  console.log(
    `Acknowledged ${topic} ${eventAction ?? "event"} (${handle ?? "no-handle"}) for ${shop}`,
  );
  return new Response(null, { status: 200 });
};
