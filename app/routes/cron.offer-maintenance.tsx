import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { notifyExpirationReminders } from "../lib/emails.server";
import { expireOverdueOffers } from "../lib/portal.server";

/**
 * Scheduled maintenance for time-based offer state.
 *
 * `expireOverdueOffers` also runs from the request loaders, so status stays
 * correct for anyone browsing the app. This endpoint exists because expiration
 * reminder emails have to go out whether or not somebody happens to load a
 * page, which means they need an external scheduler.
 *
 * Call it from cron, a platform scheduler, or Shopify Flow:
 *   curl -X POST https://<app-url>/cron/offer-maintenance \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Running it more often than the reminder window is harmless: reminders are
 * deduplicated by the email idempotency key, and expiry is derived from
 * `offer.expiresAt` rather than from how often this runs.
 */

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function listInstalledShops(): Promise<string[]> {
  const [sessions, settings] = await Promise.all([
    prisma.session.findMany({ select: { shop: true }, distinct: ["shop"] }),
    prisma.shopSettings.findMany({ select: { shop: true } }),
  ]);
  return [
    ...new Set([
      ...sessions.map((row) => row.shop),
      ...settings.map((row) => row.shop),
    ]),
  ];
}

async function runMaintenance(request: Request) {
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const shops = await listInstalledShops();

  const results: Array<{ shop: string; expired: number; error?: string }> = [];
  for (const shop of shops) {
    try {
      const expired = await expireOverdueOffers(shop);
      await notifyExpirationReminders(shop, appUrl);
      results.push({ shop, expired });
    } catch (error) {
      // One misconfigured shop must not stop maintenance for the others.
      results.push({
        shop,
        expired: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return Response.json({
    ok: true,
    ranAt: new Date().toISOString(),
    shops: results,
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return runMaintenance(request);
};

// Some schedulers can only issue GETs.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return runMaintenance(request);
};
