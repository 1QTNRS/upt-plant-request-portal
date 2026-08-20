import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { markRequestPaid, findRequestByNumber } from "../lib/portal.server";

type PaidOrderPayload = {
  admin_graphql_api_id?: string;
  order_number?: number | string;
  name?: string;
  email?: string;
  note?: string;
  tags?: string;
  line_items?: Array<{ title?: string; price?: string; quantity?: number }>;
};

function plantRevenueFromPayload(payload: PaidOrderPayload): number {
  return (payload.line_items ?? [])
    .filter((item) => {
      const title = (item.title ?? "").toLowerCase();
      return !title.includes("fedex") && !title.includes("priority overnight");
    })
    .reduce((sum, item) => {
      const price = Number.parseFloat(item.price ?? "0");
      const quantity = item.quantity ?? 1;
      return sum + (Number.isFinite(price) ? price * quantity : 0);
    }, 0);
}

function requestNumberFromPayload(payload: PaidOrderPayload): string | null {
  const tagMatch = (payload.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .find((tag) => tag.startsWith("UPT-REQ-"));
  if (tagMatch) return tagMatch;

  const note = payload.note ?? "";
  const noteMatch = note.match(/UPT-REQ-\d{4}-\d+/);
  return noteMatch?.[0] ?? null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as PaidOrderPayload;
  const requestNumber = requestNumberFromPayload(order);
  if (!requestNumber) {
    return new Response();
  }

  const plantRequest = await findRequestByNumber(shop, requestNumber);
  if (!plantRequest) {
    return new Response();
  }

  await markRequestPaid(shop, plantRequest.id, {
    shopifyOrderGid: order.admin_graphql_api_id || `gid://shopify/Order/${requestNumber}`,
    orderNumber: String(order.name || order.order_number || ""),
    plantRevenue: plantRevenueFromPayload(order),
  });

  return new Response();
};
