import type { ActionFunctionArgs } from "react-router";

import {
  formatRequestNumber,
  parseRequestNumber,
  plantRevenueFromLines,
} from "../lib/portal";
import {
  findRequestByNumber,
  getDraftOrder,
  markRequestPaid,
  parseDraftOrderLineItems,
} from "../lib/portal.server";
import { authenticate } from "../shopify.server";

type PaidOrderPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  order_number?: number | string;
  name?: string;
  email?: string;
  note?: string;
  tags?: string;
  line_items?: Array<{ title?: string; price?: string; quantity?: number }>;
};

/**
 * Last resort when no draft order was recorded for the request.
 *
 * The shipping upgrade is identified by its title, which is not the app's to
 * control: once `ShopSettings.fedexVariantGid` is set the line is submitted as
 * a variant and Shopify names it after the real product. Renaming that product
 * to anything without these substrings would fold shipping into the stored
 * `plantRevenue`, and that one value feeds every revenue figure on the
 * dashboard. Prefer `plantRevenueFromRecordedLines`, which reads a `kind` the
 * app sets itself.
 */
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

/** Plant revenue from the lines the app itself recorded, or null if it has none. */
async function plantRevenueFromRecordedLines(
  shop: string,
  requestId: string,
): Promise<number | null> {
  const draftOrder = await getDraftOrder(shop, requestId);
  const lines = parseDraftOrderLineItems(draftOrder?.lineItemsJson);
  if (lines.length === 0) return null;
  return plantRevenueFromLines(lines);
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

function orderLabel(order: PaidOrderPayload): string {
  return String(order.name || order.order_number || order.id || "unknown order");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const order = payload as PaidOrderPayload;

  const requestNumber = requestNumberFromPayload(order);
  if (!requestNumber) {
    // Not every paid order comes from a plant request. Retrying will not help,
    // so acknowledge, but log enough to diagnose a draft order that lost its
    // tag and left a request stuck in Pending.
    console.log(
      `${topic} for ${shop}: order ${orderLabel(order)} carries no plant request number; ignoring.`,
    );
    return new Response();
  }

  const plantRequest = await findRequestByNumber(shop, requestNumber);
  if (!plantRequest) {
    console.warn(
      `${topic} for ${shop}: order ${orderLabel(order)} references ${requestNumber}, which does not exist.`,
    );
    return new Response();
  }

  if (plantRequest.paidAt) {
    // Shopify redelivers on any non-2xx response, and re-closing would append a
    // duplicate status event to the request's history.
    console.log(
      `${topic} for ${shop}: ${requestNumber} is already paid; ignoring redelivery of order ${orderLabel(order)}.`,
    );
    return new Response();
  }

  const shopifyOrderGid =
    order.admin_graphql_api_id ||
    (order.id ? `gid://shopify/Order/${order.id}` : null);
  if (!shopifyOrderGid) {
    console.error(
      `${topic} for ${shop}: order ${orderLabel(order)} has no Shopify order id; not closing ${requestNumber}.`,
    );
    return new Response();
  }

  const recorded = await plantRevenueFromRecordedLines(shop, plantRequest.id);
  await markRequestPaid(shop, plantRequest.id, {
    shopifyOrderGid,
    orderNumber: String(order.name || order.order_number || ""),
    plantRevenue: recorded ?? plantRevenueFromPayload(order),
  });
  console.log(`${topic} for ${shop}: closed ${requestNumber} from order ${orderLabel(order)}.`);

  return new Response();
};
