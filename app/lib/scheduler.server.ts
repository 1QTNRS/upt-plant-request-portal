import { createHmac, timingSafeEqual } from "node:crypto";

import prisma from "../db.server";
import { notifyExpirationReminders } from "./emails.server";
import { expireOverdueOffers } from "./portal.server";

export type ShopMaintenanceResult = {
  shop: string;
  expired: number;
  remindersSent: number;
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
  const [requests, sessions] = await Promise.all([
    prisma.plantRequest.findMany({ distinct: ["shop"], select: { shop: true } }),
    prisma.session.findMany({ distinct: ["shop"], select: { shop: true } }),
  ]);
  return [
    ...new Set([
      ...requests.map((row) => row.shop),
      ...sessions.map((row) => row.shop),
    ]),
  ].sort();
}

/**
 * Flips unpaid offers past their hold to Expired and emails a reminder for
 * offers expiring within 24 hours.
 *
 * `expireOverdueOffers` also runs from request loaders, so it stays the source
 * of truth for status; this only guarantees it happens without someone opening
 * a page. Reminder emails are only ever sent from here, and
 * `notifyExpirationReminders` skips a request that already has one, so running
 * this more often than once a day is harmless.
 */
export async function runOfferMaintenance(
  appUrl = process.env.SHOPIFY_APP_URL ?? "",
): Promise<MaintenanceResult> {
  const shops = await shopsWithPortalData();
  const results: ShopMaintenanceResult[] = [];

  for (const shop of shops) {
    try {
      const expired = await expireOverdueOffers(shop);
      const before = await countReminders(shop);
      await notifyExpirationReminders(shop, appUrl);
      const after = await countReminders(shop);
      results.push({ shop, expired, remindersSent: after - before });
    } catch (error) {
      // One broken shop must not stop the sweep for the others.
      results.push({
        shop,
        expired: 0,
        remindersSent: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { ranAt: new Date().toISOString(), shops: results };
}

function countReminders(shop: string): Promise<number> {
  return prisma.emailMessage.count({
    where: { shop, templateKey: "expiration_reminder" },
  });
}
