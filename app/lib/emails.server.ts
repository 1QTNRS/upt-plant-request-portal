import prisma from "../db.server";
import {
  buildAdminNewRequestEmail,
  buildCheckoutEmail,
  buildConfirmationEmail,
  buildExpirationReminderEmail,
  buildOfferReadyEmail,
  buildRequestReceivedEmail,
  DEFAULT_FEDEX_REMOVAL_WARNING,
} from "./portal";
import { getRequest, getShopSettings } from "./portal.server";

async function queueEmail(input: {
  shop: string;
  requestId?: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  templateKey: string;
}) {
  if (!input.toEmail.trim()) return null;

  const message = await prisma.emailMessage.create({
    data: {
      shop: input.shop,
      requestId: input.requestId,
      toEmail: input.toEmail,
      subject: input.subject,
      bodyText: input.bodyText,
      templateKey: input.templateKey,
      status: "queued",
    },
  });

  const delivered = await deliverEmail(message.id, input.toEmail, input.subject, input.bodyText);
  return delivered;
}

async function deliverEmail(
  id: string,
  toEmail: string,
  subject: string,
  bodyText: string,
) {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "UPT Plant Requests <noreply@unsolicitedplanttalks.com>";

  if (!resendKey) {
    await prisma.emailMessage.update({
      where: { id },
      data: { status: "preview" },
    });
    return prisma.emailMessage.findUnique({ where: { id } });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        text: bodyText,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      await prisma.emailMessage.update({
        where: { id },
        data: { status: "failed", error: error.slice(0, 1000) },
      });
      return prisma.emailMessage.findUnique({ where: { id } });
    }

    await prisma.emailMessage.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  } catch (error) {
    await prisma.emailMessage.update({
      where: { id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown email error",
      },
    });
  }

  return prisma.emailMessage.findUnique({ where: { id } });
}

export async function notifyNewRequest(shop: string, requestId: string) {
  const request = await getRequest(shop, requestId);
  if (!request) return;

  const settings = await getShopSettings(shop);
  const adminEmail =
    settings.adminNotificationEmail || process.env.UPT_ADMIN_EMAIL || "";
  const plantNames = request.items.map((item) => item.plantName);

  const customerEmail = buildRequestReceivedEmail({
    customerName: request.customer,
    requestNumber: request.requestNumber,
    plantNames,
  });
  await queueEmail({
    shop,
    requestId,
    toEmail: request.email,
    ...customerEmail,
    templateKey: "request_received",
  });

  if (adminEmail) {
    const admin = buildAdminNewRequestEmail({
      requestNumber: request.requestNumber,
      customerName: request.customer,
      customerEmail: request.email,
      plantNames,
    });
    await queueEmail({
      shop,
      requestId,
      toEmail: adminEmail,
      ...admin,
      templateKey: "admin_new_request",
    });
  }
}

export async function notifyOfferReady(shop: string, requestId: string, appUrl: string) {
  const request = await getRequest(shop, requestId);
  if (!request?.sentOffer) return;

  const offerLink = `${appUrl.replace(/\/$/, "")}/customer/requests/${request.id}`;
  const email = buildOfferReadyEmail({
    customerName: request.customer,
    requestNumber: request.requestNumber,
    expiresAt: request.sentOffer.expiresAt,
    offerLink,
  });
  await queueEmail({
    shop,
    requestId,
    toEmail: request.email,
    ...email,
    templateKey: "offer_ready",
  });
}

export async function notifyCheckoutLink(
  shop: string,
  requestId: string,
  invoiceUrl: string,
) {
  const request = await getRequest(shop, requestId);
  if (!request) return;

  const email = buildCheckoutEmail({
    customerName: request.customer,
    requestNumber: request.requestNumber,
    invoiceUrl,
  });
  await queueEmail({
    shop,
    requestId,
    toEmail: request.email,
    ...email,
    templateKey: "checkout_link",
  });
}

export async function notifyConfirmation(
  shop: string,
  input: {
    requestId: string;
    acceptedItems: Array<{
      plantName: string;
      price: number;
      quantity: number;
      customerNotes: string;
    }>;
    fedexSelected: boolean;
    fedexPrice: number;
    invoiceUrl?: string;
  },
) {
  const request = await getRequest(shop, input.requestId);
  if (!request) return;
  const settings = await getShopSettings(shop);

  const email = buildConfirmationEmail({
    customerName: request.customer,
    customerEmail: request.email,
    requestNumber: request.requestNumber,
    acceptedItems: input.acceptedItems,
    fedexSelected: input.fedexSelected,
    fedexPrice: input.fedexPrice,
    fedexDisclaimer: input.fedexSelected
      ? undefined
      : settings.fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING,
    invoiceUrl: input.invoiceUrl,
  });

  await queueEmail({
    shop,
    requestId: input.requestId,
    toEmail: request.email,
    ...email,
    templateKey: "confirmation",
  });
}

export async function notifyExpirationReminders(shop: string, appUrl: string) {
  const soon = new Date();
  soon.setHours(soon.getHours() + 24);
  const now = new Date();

  const pending = await prisma.plantRequest.findMany({
    where: {
      shop,
      status: "Pending",
      paidAt: null,
      offer: {
        expiresAt: { gt: now, lte: soon },
      },
    },
    include: { offer: true, emails: true },
  });

  for (const request of pending) {
    const alreadySent = request.emails.some(
      (email) => email.templateKey === "expiration_reminder",
    );
    if (alreadySent || !request.offer) continue;

    const email = buildExpirationReminderEmail({
      customerName: request.customerName,
      requestNumber: request.requestNumber,
      expiresAt: request.offer.expiresAt.toISOString(),
      offerLink: `${appUrl.replace(/\/$/, "")}/customer/requests/${request.id}`,
    });
    await queueEmail({
      shop,
      requestId: request.id,
      toEmail: request.customerEmail,
      ...email,
      templateKey: "expiration_reminder",
    });
  }
}

export async function listEmailsForRequest(shop: string, requestId: string) {
  return prisma.emailMessage.findMany({
    where: { shop, requestId },
    orderBy: { createdAt: "desc" },
  });
}
