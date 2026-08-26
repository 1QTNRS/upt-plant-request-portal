import type { EmailMessage } from "@prisma/client";

import prisma from "../db.server";
import { customerLinksForShop } from "./customer-links.server";
import { DEFAULT_EMAIL_FROM, isProduction } from "./env.server";
import {
  buildAdminNewRequestEmail,
  buildAdminPaymentAfterVoidEmail,
  buildAdminResponseEmail,
  buildCheckoutEmail,
  buildOfferReadyEmail,
  buildRequestReceivedEmail,
  buildResponseSummaryEmail,
  DEFAULT_FEDEX_REMOVAL_WARNING,
  offerIsAllExactPlants,
  type ResponseSummaryItem,
} from "./portal";
import { formatCustomerDateTime } from "./customer-time";
import { getCustomerTimeZone, getRequest, getShopSettings } from "./portal.server";

/**
 * Identifies a message that must only ever be sent once. Retries, double
 * submits and webhook redeliveries all produce the same key.
 */
function defaultIdempotencyKey(templateKey: string, requestId?: string): string | undefined {
  return requestId ? `${templateKey}:${requestId}` : undefined;
}

export type QueueEmailInput = {
  shop: string;
  requestId?: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  templateKey: string;
  idempotencyKey?: string;
  /** Injected by tests; otherwise resolved from RESEND_API_KEY. */
  sender?: EmailSender;
};

export async function queueEmail(input: QueueEmailInput) {
  if (!input.toEmail.trim()) {
    // Clearing the admin notification address in Settings silently stops every
    // admin notification, so the omission has to leave a trace somewhere.
    console.warn(
      `No recipient for the "${input.templateKey}" email on ${input.shop}${
        input.requestId ? ` (request ${input.requestId})` : ""
      }: nothing was queued.`,
    );
    return null;
  }

  const idempotencyKey =
    input.idempotencyKey ?? defaultIdempotencyKey(input.templateKey, input.requestId);

  if (idempotencyKey) {
    const existing = await prisma.emailMessage.findFirst({
      where: { shop: input.shop, idempotencyKey },
    });
    // Only a sent message is finished. Returning a queued, preview or failed
    // row untouched is what used to make a single lost message permanent — the
    // customer was never told about their offer and nothing ever tried again.
    if (existing?.status === "sent") return existing;
    if (existing) return deliverEmail(existing, input.sender);
  }

  let message;
  try {
    message = await prisma.emailMessage.create({
      data: {
        shop: input.shop,
        requestId: input.requestId,
        toEmail: input.toEmail,
        subject: input.subject,
        bodyText: input.bodyText,
        templateKey: input.templateKey,
        status: "queued",
        idempotencyKey,
      },
    });
  } catch (error) {
    // Lost a race against a concurrent request for the same key. The other
    // caller is delivering it right now; attempting it here too would only
    // duplicate the work, and the redelivery sweep covers it if that fails.
    if (idempotencyKey && isUniqueConstraintError(error)) {
      return prisma.emailMessage.findFirst({
        where: { shop: input.shop, idempotencyKey },
      });
    }
    throw error;
  }

  return deliverEmail(message, input.sender);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/** Resend's error body is JSON; its `message` is what a human needs to see. */
export function summarizeResendError(status: number, body: string): string {
  let message = body.trim();
  try {
    const parsed = JSON.parse(body) as { message?: string; name?: string };
    if (parsed.message) {
      message = parsed.name ? `${parsed.name}: ${parsed.message}` : parsed.message;
    }
  } catch {
    // Not JSON; fall through to the raw body.
  }
  if (status === 403 && /domain|verif/i.test(message)) {
    message += " Verify the EMAIL_FROM domain in the Resend dashboard under Domains.";
  }
  return `Resend responded ${status}: ${message}`.slice(0, 1000);
}

/** Resend answers a successful send with `{"id": "..."}`. */
export function parseResendMessageId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

export type EmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; retryable: boolean };

/** The one call that leaves the process. Replaceable so delivery is testable. */
export type EmailSender = (message: {
  /** Also Resend's idempotency key, so a lost reply cannot double-send. */
  id: string;
  from: string;
  toEmail: string;
  subject: string;
  bodyText: string;
}) => Promise<EmailSendResult>;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DELIVERY_ATTEMPTS = 3;

/**
 * A hung `api.resend.com` used to hold the customer's own form POST open for
 * the whole retry loop. Their plant request is already committed by then, so
 * they would see an error for a request that exists and submit it again.
 */
const RESEND_TIMEOUT_MS = 10_000;

function retryDelayMs(attempt: number): number {
  return 250 * 2 ** attempt;
}

export function resendSender(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return async (message) => {
    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Resend honours this for 24 hours. Without it a send whose reply was
          // lost is indistinguishable from one that never happened, so every
          // retry below is a second copy in the customer's inbox.
          "Idempotency-Key": message.id,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.toEmail],
          subject: message.subject,
          text: message.bodyText,
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });

      const body = await response.text();
      if (response.ok) {
        return { ok: true, providerMessageId: parseResendMessageId(body) };
      }
      return {
        ok: false,
        error: summarizeResendError(response.status, body),
        // A rejected address or unverified domain will be rejected again.
        retryable: RETRYABLE_STATUSES.has(response.status),
      };
    } catch (error) {
      // A timeout or a dropped connection. Resend may still have accepted the
      // message, which is what the idempotency key above protects.
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown email error",
        retryable: true,
      };
    }
  };
}

/** Null when RESEND_API_KEY is unset: there is nothing to deliver through. */
export function resolveEmailSender(): EmailSender | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? resendSender(apiKey) : null;
}

async function deliverEmail(
  message: EmailMessage,
  sender?: EmailSender,
): Promise<EmailMessage> {
  const from = process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  const send = sender ?? resolveEmailSender();

  if (!send) {
    if (isProduction()) {
      // Customers never receive offer or checkout links in this state, so it
      // must be visible in the logs rather than only as an outbox row.
      console.warn(
        `RESEND_API_KEY is not set: "${message.subject}" for ${message.toEmail} was stored but not delivered.`,
      );
    }
    return prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "preview" },
    });
  }

  if (!process.env.EMAIL_FROM && isProduction()) {
    console.warn(
      `EMAIL_FROM is not set: sending "${message.subject}" as ${DEFAULT_EMAIL_FROM}, which may not be a verified Resend sender.`,
    );
  }

  let lastError = "Unknown email error";
  let attempts = message.attempts;

  for (let attempt = 0; attempt < DELIVERY_ATTEMPTS; attempt += 1) {
    attempts += 1;
    const result = await send({
      id: message.id,
      from,
      toEmail: message.toEmail,
      subject: message.subject,
      bodyText: message.bodyText,
    });

    if (result.ok) {
      return prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          error: null,
          attempts,
          providerMessageId: result.providerMessageId ?? message.providerMessageId,
        },
      });
    }

    lastError = result.error;
    if (!result.retryable) break;
    if (attempt < DELIVERY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }

  console.error(
    `Could not deliver "${message.subject}" to ${message.toEmail}: ${lastError}`,
  );
  return prisma.emailMessage.update({
    where: { id: message.id },
    data: { status: "failed", error: lastError, attempts },
  });
}

/** Anything that has not reached the recipient yet. */
const UNDELIVERED_STATUSES = ["queued", "failed", "preview"];

/**
 * Total Resend calls one message may ever cost. `DELIVERY_ATTEMPTS` of them go
 * on the first try, and a permanently rejected address only spends one per
 * sweep, so this is roughly a day of hourly retries before the portal gives up
 * and leaves the row for a human.
 */
const MAX_DELIVERY_ATTEMPTS = 24;

/** Messages retried per shop per sweep, so one shop cannot monopolise a run. */
const REDELIVERY_BATCH = 20;

/**
 * Retries messages that never reached their recipient, oldest first.
 *
 * Every template matters to someone: a lost `offer_ready` means the customer is
 * never told they have an offer, the hold lapses, and the plant is released for
 * listing without anyone knowing an email failed. `preview` rows are included
 * because everything queued before RESEND_API_KEY was configured is sitting in
 * that state.
 */
export async function redeliverPendingEmails(
  shop: string,
  options: { limit?: number; sender?: EmailSender } = {},
): Promise<{ attempted: number; delivered: number }> {
  const sender = options.sender ?? resolveEmailSender();
  // Without a Resend key nothing can be delivered, and re-running delivery
  // would only overwrite the recorded error with `preview`.
  if (!sender) return { attempted: 0, delivered: 0 };

  const pending = await prisma.emailMessage.findMany({
    where: {
      shop,
      status: { in: UNDELIVERED_STATUSES },
      attempts: { lt: MAX_DELIVERY_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? REDELIVERY_BATCH,
  });

  let delivered = 0;
  for (const message of pending) {
    const updated = await deliverEmail(message, sender);
    if (updated.status === "sent") delivered += 1;
  }

  return { attempted: pending.length, delivered };
}

/**
 * Retries one message on demand from the admin request page. Ignores the
 * attempt bound: a human asking again is not a runaway loop.
 */
export async function redeliverEmailMessage(
  shop: string,
  id: string,
  options: { sender?: EmailSender } = {},
): Promise<EmailMessage | null> {
  const message = await prisma.emailMessage.findFirst({ where: { id, shop } });
  if (!message) return null;
  if (message.status === "sent") return message;
  return deliverEmail(message, options.sender);
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

  if (adminEmail && settings.adminEmailNewRequest) {
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

  const offerLink = customerLinksForShop(shop, appUrl).requestDetail(request.id);
  const timeZone = await getCustomerTimeZone(shop, request.email);
  const availableItems = request.items
    .filter((item) => item.availability === "available")
    .map((item) => ({
      name: item.offeredName || item.plantName,
      notes: item.customerFacingNotes,
    }));
  const unavailableItems = request.items
    .filter((item) => item.availability === "not_available")
    .map((item) => ({
      name: item.offeredName || item.plantName,
      reason: item.unavailableReason,
      notes: item.customerFacingNotes,
    }));
  const email = buildOfferReadyEmail({
    customerName: request.customer,
    requestNumber: request.requestNumber,
    expiresAt: formatCustomerDateTime(
      new Date(request.sentOffer.expiresAtIso),
      timeZone,
    ),
    offerLink,
    allExactPlants: offerIsAllExactPlants(request.items),
    availableItems,
    unavailableItems,
  });
  return queueEmail({
    shop,
    requestId,
    toEmail: request.email,
    ...email,
    templateKey: "offer_ready",
  });
}

/**
 * Manual recovery only. The happy path does not email a checkout link —
 * Accept/Reject happens first, then the portal shows the invoice URL, and
 * Shopify sends the paid-order confirmation. Admin "Resend payment link"
 * is the only automatic-looking caller, and it is a human action.
 */
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
  return queueEmail({
    shop,
    requestId,
    toEmail: request.email,
    ...email,
    templateKey: "checkout_link",
  });
}

/**
 * The single customer email for a submitted response.
 *
 * Keyed on `confirmation:{requestId}`, so a retry or a double submit cannot
 * send a second copy — and the key is the one the separate confirmation used,
 * so a customer who already has that mail is not sent this one as well.
 */
export async function notifyResponseSummary(
  shop: string,
  input: {
    requestId: string;
    acceptedItems: ResponseSummaryItem[];
    rejectedItems: ResponseSummaryItem[];
    fedexSelected: boolean;
    fedexPrice: number;
    invoiceUrl?: string;
  },
) {
  const request = await getRequest(shop, input.requestId);
  if (!request) return;
  const settings = await getShopSettings(shop);

  const email = buildResponseSummaryEmail({
    customerName: request.customer,
    requestNumber: request.requestNumber,
    acceptedItems: input.acceptedItems,
    rejectedItems: input.rejectedItems,
    fedexSelected: input.fedexSelected,
    fedexPrice: input.fedexPrice,
    fedexDisclaimer: input.fedexSelected
      ? undefined
      : settings.fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING,
    invoiceUrl: input.invoiceUrl,
    // Only accepted plants are still held, and only then is the hold something
    // the customer has to act before.
    expiresAt:
      input.acceptedItems.length > 0 && request.sentOffer
        ? formatCustomerDateTime(
            new Date(request.sentOffer.expiresAtIso),
            await getCustomerTimeZone(shop, request.email),
          )
        : undefined,
  });

  return queueEmail({
    shop,
    requestId: input.requestId,
    toEmail: request.email,
    ...email,
    templateKey: "confirmation",
  });
}

/**
 * Tells UPT that a customer answered, once per response.
 *
 * One of only two events that reach the admin mailbox; the other is a new
 * request. Anything per item, per status change or per payment is Shopify's job
 * or nobody's.
 */
export async function notifyAdminResponse(
  shop: string,
  input: { requestId: string; acceptedCount: number; rejectedCount: number },
) {
  const request = await getRequest(shop, input.requestId);
  if (!request) return;

  const settings = await getShopSettings(shop);
  const adminEmail =
    settings.adminNotificationEmail || process.env.UPT_ADMIN_EMAIL || "";
  if (!adminEmail || !settings.adminEmailCustomerResponse) return;

  const email = buildAdminResponseEmail({
    requestNumber: request.requestNumber,
    customerName: request.customer,
    customerEmail: request.email,
    acceptedCount: input.acceptedCount,
    rejectedCount: input.rejectedCount,
  });

  return queueEmail({
    shop,
    requestId: input.requestId,
    toEmail: adminEmail,
    ...email,
    templateKey: "admin_response",
  });
}

/**
 * One important mail when money arrives after the invoice was already voided.
 *
 * Distinct from `admin_response` and from Shopify's own paid-order mail: this
 * is the exceptional case that needs a human to check whether the plant was
 * already relisted. The idempotency key keeps a webhook retry from sending it
 * twice.
 */
export async function notifyAdminPaymentAfterVoid(
  shop: string,
  input: { requestId: string; orderNumber?: string },
) {
  const request = await getRequest(shop, input.requestId);
  if (!request) return;

  const settings = await getShopSettings(shop);
  const adminEmail =
    settings.adminNotificationEmail || process.env.UPT_ADMIN_EMAIL || "";
  if (!adminEmail || !settings.adminEmailPaymentAfterVoid) return;

  const email = buildAdminPaymentAfterVoidEmail({
    requestNumber: request.requestNumber,
    orderNumber: input.orderNumber,
  });

  return queueEmail({
    shop,
    requestId: input.requestId,
    toEmail: adminEmail,
    ...email,
    templateKey: "admin_payment_after_void",
  });
}

/**
 * Automatic expiration reminders would be a fourth customer email on the
 * happy path (received → admin response → reminder → Shopify payment mail).
 * The portal hard-caps automatic customer mail at three, so this is a no-op.
 * Failed offer_ready rows are retried by the outbox sweep; a missing payment
 * link is recovered with the admin "Resend payment link" action.
 */
export async function notifyExpirationReminders(_shop: string, _appUrl: string) {
  return;
}

/**
 * The outbox as the merchant sees it. `bodyText` is deliberately excluded: it
 * carries payment links, and the request page has no reason to render them.
 */
export async function listEmailsForRequest(shop: string, requestId: string) {
  return prisma.emailMessage.findMany({
    where: { shop, requestId },
    select: {
      id: true,
      templateKey: true,
      toEmail: true,
      subject: true,
      status: true,
      error: true,
      attempts: true,
      createdAt: true,
      sentAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
