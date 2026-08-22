import type { ActionFunctionArgs } from "react-router";

import {
  formatRequestNumber,
  parseRequestNumber,
  plantRevenueFromLines,
  plantRevenueFromPaidOrderLines,
  type PaidOrderLine,
} from "../lib/portal";
import { notifyAdminPaymentAfterVoid } from "../lib/emails.server";
import {
  findRequestByNumber,
  getCustomerResponse,
  getDraftOrder,
  getShopSettings,
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
  line_items?: PaidOrderLine[];
};

/**
 * Last resort when no draft order was recorded for the request, so the lines
 * carry no `kind` the app set itself.
 *
 * The shipping upgrade is recognized from the variant and label the app stores
 * for it, never from a substring of a title the merchant owns. When the
 * customer paid for the upgrade and no line matches either, the shipping charge
 * is counted as plant revenue and said out loud: this one value feeds every
 * revenue figure on the dashboard, so over-stating it by the upgrade beats
 * dropping a plant.
 */
async function plantRevenueFromPayload(
  shop: string,
  requestId: string,
  payload: PaidOrderPayload,
): Promise<number> {
  const settings = await getShopSettings(shop);
  const response = await getCustomerResponse(shop, requestId);
  const lines = payload.line_items ?? [];
  const result = plantRevenueFromPaidOrderLines(lines, {
    variantGid: settings.fedexVariantGid,
    upgradeLabel: settings.fedexUpgradeLabel,
    upgradeSelected: response?.fedexUpgradeSelected,
  });

  if (result.unidentifiedUpgrade) {
    console.error(
      `orders/paid for ${shop}: order ${orderLabel(payload)} kept the ` +
        `${settings.fedexUpgradeLabel} upgrade, but none of its ${lines.length} ` +
        "line item(s) match the stored FedEx variant or label, so plant revenue " +
        `of ${result.plantRevenue} still includes the shipping charge. Check ` +
        "ShopSettings.fedexVariantGid and fedexUpgradeLabel against the store.",
    );
  }

  return result.plantRevenue;
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
  const draft = await getDraftOrder(shop, plantRequest.id);
  const paymentAfterVoid =
    Boolean(draft?.voidedAt) || plantRequest.status === "Expired";
  await markRequestPaid(shop, plantRequest.id, {
    shopifyOrderGid,
    orderNumber: String(order.name || order.order_number || ""),
    plantRevenue:
      recorded ?? (await plantRevenueFromPayload(shop, plantRequest.id, order)),
  });
  if (paymentAfterVoid) {
    await notifyAdminPaymentAfterVoid(shop, {
      requestId: plantRequest.id,
      orderNumber: String(order.name || order.order_number || ""),
    });
    console.warn(
      `${topic} for ${shop}: ${requestNumber} paid after expiration/void from order ${orderLabel(order)}.`,
    );
  } else {
    console.log(`${topic} for ${shop}: closed ${requestNumber} from order ${orderLabel(order)}.`);
  }

  return new Response();
};
