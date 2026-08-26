import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  cronSecretMatches,
  readCronSecret,
  runOfferMaintenance,
} from "../lib/scheduler.server";

/**
 * Scheduler entry point for offer expiry, unpaid invoice void, and outbox
 * redelivery. Automatic expiration-reminder emails are no longer sent.
 *
 * Call this hourly from any scheduler that can make an authenticated HTTPS
 * request:
 *
 *   curl -fsS -X POST https://<app-url>/cron/offer-maintenance \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * The route is hidden (404) until CRON_SECRET is set so an unconfigured deploy
 * cannot expose it.
 */
async function handle(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET is not configured." },
      { status: 404 },
    );
  }

  if (!cronSecretMatches(readCronSecret(request), expected)) {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  try {
    const result = await runOfferMaintenance();
    return Response.json(result);
  } catch (error) {
    console.error("Offer maintenance run failed.", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const action = async ({ request }: ActionFunctionArgs) => handle(request);

// GET is supported because several hosted schedulers can only issue GETs.
export const loader = async ({ request }: LoaderFunctionArgs) => handle(request);
