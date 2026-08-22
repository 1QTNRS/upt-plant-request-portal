import { createHmac, timingSafeEqual } from "node:crypto";

import prisma from "../db.server";
import { voidExpiredDraftOrders } from "./draft-order-void.server";
import { notifyExpirationReminders, redeliverPendingEmails } from "./emails.server";
import { expireOverdueOffers } from "./portal.server";
import type { GraphqlClient } from "./shopify-ops.server";

/** Loaded lazily so unit tests of the sweep do not boot the Shopify SDK. */
export type SweepAdminLoader = (
  shop: string,
) => Promise<GraphqlClient | undefined>;

async function defaultSweepAdmin(shop: string): Promise<GraphqlClient | undefined> {
  const { offlineAdminClient } = await import("./offline-admin.server");
  return offlineAdminClient(shop);
}

export type ShopMaintenanceResult = {
  shop: string;
  expired: number;
  invoicesVoided: number;
  /** Reminder rows created. Not the same as reminders that reached anyone. */
  remindersQueued: number;
  remindersSent: number;
  emailsRetried: number;
  emailsRedelivered: number;
  error?: string;
};

export type MaintenanceResult = {
  ranAt: string;
  shops: ShopMaintenanceResult[];
};

/**
 * Constant-time comparison over a fixed-length digest so a wrong secret cannot
 * be discovered from response timing or from a length mismatch.
 */
export function cronSecretMatches(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !provided) return false;
  const key = "upt-cron";
  const a = createHmac("sha256", key).update(provided).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Accepts `Authorization: Bearer <secret>` and the `X-Cron-Secret` header. */
export function readCronSecret(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return request.headers.get("X-Cron-Secret");
}

/**
 * Every shop the portal holds data for. Offer expiry has to run per shop, and
 * a shop that uninstalled the app still has requests that should not be left
 * sitting in Pending forever.
 */
export async function shopsWithPortalData(): Promise<string[]> {
  // groupBy pushes the DISTINCT into SQL. Prisma applies `distinct` on
  // findMany in memory, so this hourly job was reading every request and every
  // session row across the wire to produce a list of one.
  const [requests, sessions] = await Promise.all([
    prisma.plantRequest.groupBy({ by: ["shop"] }),
    prisma.session.groupBy({ by: ["shop"] }),
  ]);
  return [
    ...new Set([
      ...requests.map((row) => row.shop),
      ...sessions.map((row) => row.shop),
    ]),
  ].sort();
}

/**
 * Flips unpaid offers past their hold to Expired, retries email nobody received
 * and emails a reminder for offers expiring within 24 hours.
 *
 * `expireOverdueOffers` also runs from request loaders, so it stays the source
 * of truth for status; this only guarantees it happens without someone opening
 * a page. Reminder emails are only ever sent from here, and
 * `notifyExpirationReminders` skips a request that already has one, so running
 * this more often than once a day is harmless.
 */
export async function runOfferMaintenance(
  appUrl = process.env.SHOPIFY_APP_URL ?? "",
  loadAdmin: SweepAdminLoader = defaultSweepAdmin,
): Promise<MaintenanceResult> {
  const shops = await shopsWithPortalData();
  const results: ShopMaintenanceResult[] = [];

  for (const shop of shops) {
    try {
      const expired = await expireOverdueOffers(shop);
      const admin = await loadAdmin(shop);
      const voided = await voidExpiredDraftOrders(shop, admin);
      // Retried before the reminders so a reminder queued by this same run is
      // not attempted twice within it, which would burn its attempt budget.
      const retried = await redeliverPendingEmails(shop);
      const before = await countReminders(shop);
      await notifyExpirationReminders(shop, appUrl);
      const after = await countReminders(shop);
      results.push({
        shop,
        expired,
        invoicesVoided: voided.voided,
        remindersQueued: after.queued - before.queued,
        remindersSent: after.sent - before.sent,
        emailsRetried: retried.attempted,
        emailsRedelivered: retried.delivered,
      });
    } catch (error) {
      // One broken shop must not stop the sweep for the others.
      results.push({
        shop,
        expired: 0,
        invoicesVoided: 0,
        remindersQueued: 0,
        remindersSent: 0,
        emailsRetried: 0,
        emailsRedelivered: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { ranAt: new Date().toISOString(), shops: results };
}

/**
 * Rows and deliveries counted apart. A total Resend outage still creates a
 * reminder row per request, so counting rows alone reported "reminders sent"
 * for a run in which nobody was reminded of anything.
 */
async function countReminders(
  shop: string,
): Promise<{ queued: number; sent: number }> {
  const where = { shop, templateKey: "expiration_reminder" };
  const [queued, sent] = await Promise.all([
    prisma.emailMessage.count({ where }),
    prisma.emailMessage.count({ where: { ...where, status: "sent" } }),
  ]);
  return { queued, sent };
}
