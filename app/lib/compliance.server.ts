import prisma from "../db.server";
import { queueEmail } from "./emails.server";
import { getShopSettings } from "./portal.server";

/**
 * Shopify's mandatory privacy webhooks. Every app distributed through the App
 * Store must handle all three, and the portal stores customer names, email
 * addresses and request history, so all three have real work to do.
 */

export type CompliancePayload = {
  shop_id?: number | string;
  shop_domain?: string;
  customer?: { id?: number | string; email?: string; phone?: string };
  orders_requested?: Array<number | string>;
  orders_to_redact?: Array<number | string>;
  data_request?: { id?: number | string };
};

export type CustomerDataExport = {
  customer: { name: string; email: string; shopifyCustomerId: string | null };
  requests: Array<{
    requestNumber: string;
    status: string;
    submittedAt: string;
    plants: string[];
    response: string | null;
  }>;
};

/** Matches on the Shopify customer id, falling back to the email address. */
function customerWhere(shop: string, payload: CompliancePayload) {
  const shopifyCustomerId = payload.customer?.id
    ? String(payload.customer.id)
    : undefined;
  const email = payload.customer?.email?.trim().toLowerCase();

  const or: Array<Record<string, unknown>> = [];
  if (shopifyCustomerId) or.push({ shopifyCustomerId });
  if (email) or.push({ email });
  if (or.length === 0) return null;
  return { shop, OR: or };
}

/**
 * Distinguishes a Shopify redelivery from a genuine second data request.
 * Shopify sends `data_request.id` for this topic; the fallback is scoped to the
 * day so a request the same customer makes later is not taken for a redelivery.
 */
function dataRequestKey(payload: CompliancePayload): string {
  if (payload.data_request?.id) return String(payload.data_request.id);
  const customer = payload.customer?.id ?? payload.customer?.email ?? "unknown";
  return `${customer}:${new Date().toISOString().slice(0, 10)}`;
}

/** Renders the export as text so it can be emailed to the store owner. */
export function formatCustomerDataExport(
  exports: CustomerDataExport[],
): string {
  if (exports.length === 0) {
    return "The UPT Plant Request Portal holds no data for this customer.";
  }

  return exports
    .map((entry) => {
      const header = [
        `Name: ${entry.customer.name || "(not recorded)"}`,
        `Email: ${entry.customer.email}`,
        `Shopify customer ID: ${entry.customer.shopifyCustomerId ?? "(not linked)"}`,
      ].join("\n");

      const requests = entry.requests.length
        ? entry.requests
            .map((request) =>
              [
                `  ${request.requestNumber} — ${request.status}`,
                `    Submitted: ${request.submittedAt}`,
                `    Plants requested: ${request.plants.join(", ") || "(none)"}`,
                `    Customer response: ${request.response ?? "(none)"}`,
              ].join("\n"),
            )
            .join("\n")
        : "  (no plant requests)";

      return `${header}\n\nPlant requests:\n${requests}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Collects everything the portal stores about a customer so the store owner can
 * forward it. Queued as an outbox email rather than returned in the webhook
 * response, because Shopify only wants an acknowledgement here.
 */
export async function handleCustomerDataRequest(
  shop: string,
  payload: CompliancePayload,
): Promise<CustomerDataExport[]> {
  const where = customerWhere(shop, payload);
  if (!where) return [];

  const profiles = await prisma.customerProfile.findMany({
    where,
    include: {
      requests: {
        include: {
          items: true,
          response: { include: { items: true } },
        },
        orderBy: { submittedAt: "asc" },
      },
    },
  });

  const exports: CustomerDataExport[] = profiles.map((profile) => ({
    customer: {
      name: profile.name,
      email: profile.email,
      shopifyCustomerId: profile.shopifyCustomerId,
    },
    requests: profile.requests.map((request) => ({
      requestNumber: request.requestNumber,
      status: request.status,
      submittedAt: request.submittedAt.toISOString(),
      plants: request.items.map((item) => item.plantName),
      response:
        request.response?.items
          .map((item) => `${item.plantName}: ${item.choice}`)
          .join("; ") ?? null,
    })),
  }));

  const settings = await getShopSettings(shop);
  const adminEmail =
    settings.adminNotificationEmail || process.env.UPT_ADMIN_EMAIL || "";
  if (adminEmail) {
    // Must go through the outbox helper: a row written straight to the table is
    // never delivered by anything, and this webhook carries a legal response
    // deadline. The key covers Shopify redelivering the same request.
    await queueEmail({
      shop,
      toEmail: adminEmail,
      subject: `Customer data request — UPT Plant Request Portal (${payload.customer?.id ?? "unknown customer"})`,
      bodyText: formatCustomerDataExport(exports),
      templateKey: "compliance_data_request",
      idempotencyKey: `compliance_data_request:${dataRequestKey(payload)}`,
    });
  } else {
    console.warn(
      `customers/data_request for ${shop} could not be delivered: no admin notification email is configured.`,
    );
  }

  return exports;
}

/**
 * Erases a customer's personal data. Deleting the profile cascades to their
 * requests, items, photos, offers and responses; queued emails are removed
 * separately because their bodies contain the same personal data and
 * `EmailMessage.requestId` is nulled rather than cascaded.
 */
export async function handleCustomerRedact(
  shop: string,
  payload: CompliancePayload,
): Promise<{ profilesDeleted: number; emailsDeleted: number }> {
  const where = customerWhere(shop, payload);
  if (!where) return { profilesDeleted: 0, emailsDeleted: 0 };

  const profiles = await prisma.customerProfile.findMany({
    where,
    select: { id: true, email: true },
  });
  if (profiles.length === 0) return { profilesDeleted: 0, emailsDeleted: 0 };

  const emails = profiles.map((profile) => profile.email);
  const requestIds = (
    await prisma.plantRequest.findMany({
      where: { shop, customerId: { in: profiles.map((profile) => profile.id) } },
      select: { id: true },
    })
  ).map((request) => request.id);

  const [emailsDeleted, profilesDeleted] = await prisma.$transaction([
    prisma.emailMessage.deleteMany({
      where: {
        shop,
        OR: [{ toEmail: { in: emails } }, { requestId: { in: requestIds } }],
      },
    }),
    prisma.customerProfile.deleteMany({
      where: { id: { in: profiles.map((profile) => profile.id) } },
    }),
  ]);

  return {
    profilesDeleted: profilesDeleted.count,
    emailsDeleted: emailsDeleted.count,
  };
}

/** Erases every trace of a shop, 48 hours after the app is uninstalled. */
export async function handleShopRedact(shop: string): Promise<void> {
  await prisma.$transaction([
    prisma.emailMessage.deleteMany({ where: { shop } }),
    prisma.exactPlantListing.deleteMany({ where: { shop } }),
    prisma.plantRequest.deleteMany({ where: { shop } }),
    prisma.customerProfile.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.requestNumberSequence.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
