import type { ActionFunctionArgs } from "react-router";

import { formatRequestNumber, parseRequestNumber } from "../lib/portal";
import { findRequestByNumber, markRequestPaid } from "../lib/portal.server";
import { authenticate } from "../shopify.server";

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
  const tags = (payload.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const tagged =
    tags.find((tag) => parseRequestNumber(tag) != null) ??
    tags.find((tag) => tag.startsWith("UPT-REQ-"));
  if (tagged) {
    const parsed = parseRequestNumber(tagged);
    return parsed != null ? formatRequestNumber(parsed) : tagged;
  }

  const note = payload.note ?? "";
  const modern = note.match(/\bREQ\d+\b/i)?.[0];
  const legacy = note.match(/UPT-REQ-\d{4}-\d+/)?.[0];
  const fromNote = modern ?? legacy;
  if (!fromNote) return null;
  const parsed = parseRequestNumber(fromNote);
  return parsed != null ? formatRequestNumber(parsed) : fromNote;
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
