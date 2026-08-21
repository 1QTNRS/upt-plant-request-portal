/**
 * Calls the portal's offer-maintenance endpoint. Entry point for the Render
 * cron job defined in render.yaml.
 *
 * Deliberately dependency-free (global `fetch` only) so the cron job does not
 * install the app's dependency tree and cannot fail because of an unrelated
 * dependency problem.
 *
 * Exits non-zero when the run did not fully succeed, so Render marks the job
 * failed and notifies instead of leaving offers silently unexpired.
 *
 * Environment:
 *   CRON_SECRET             required, must match the web service
 *   OFFER_MAINTENANCE_URL   full URL; overrides the values below
 *   APP_HOSTNAME            hostname of the web service (Render supplies this
 *                           from RENDER_EXTERNAL_HOSTNAME)
 *   SHOPIFY_APP_URL         fallback base URL
 */
import process from "node:process";

const PATH = "/cron/offer-maintenance";
const TIMEOUT_MS = 120_000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveUrl() {
  if (process.env.OFFER_MAINTENANCE_URL) return process.env.OFFER_MAINTENANCE_URL;

  const hostname = process.env.APP_HOSTNAME?.trim();
  if (hostname) {
    return `https://${hostname.replace(/\/+$/, "")}${PATH}`;
  }

  const appUrl = process.env.SHOPIFY_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/+$/, "")}${PATH}`;

  return null;
}

const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  fail(
    "CRON_SECRET is not set. It must match the CRON_SECRET on the web service.",
  );
}

const url = resolveUrl();
if (!url) {
  fail(
    "Could not determine where to send the request. Set APP_HOSTNAME, " +
      "SHOPIFY_APP_URL, or OFFER_MAINTENANCE_URL.",
  );
}

console.log(`POST ${url}`);

let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (error) {
  fail(`Request failed: ${error instanceof Error ? error.message : error}`);
}

const body = await response.text();

if (!response.ok) {
  // 401 means the two services disagree about the secret. 404 means either the
  // web service has no CRON_SECRET (which disables the route) or the URL is
  // wrong. Both are silent failures otherwise.
  const hint =
    response.status === 401
      ? " CRON_SECRET does not match the web service."
      : response.status === 404
        ? " Either the web service has no CRON_SECRET configured, which disables" +
          " the route, or this URL is wrong."
        : "";
  fail(`HTTP ${response.status}: ${body}${hint}`);
}

let result;
try {
  result = JSON.parse(body);
} catch {
  fail(`Could not parse the response as JSON: ${body}`);
}

const shops = Array.isArray(result.shops) ? result.shops : [];
if (shops.length === 0) {
  console.log(`No shops with portal data. (ran at ${result.ranAt})`);
  process.exit(0);
}

let expired = 0;
let queued = 0;
let reminders = 0;
let redelivered = 0;
const failures = [];
for (const shop of shops) {
  expired += shop.expired ?? 0;
  queued += shop.remindersQueued ?? 0;
  reminders += shop.remindersSent ?? 0;
  redelivered += shop.emailsRedelivered ?? 0;
  const detail = shop.error ? ` ERROR: ${shop.error}` : "";
  console.log(
    `  ${shop.shop}: ${shop.expired} expired, ${shop.remindersSent}/${shop.remindersQueued} reminder(s) delivered, ` +
      `${shop.emailsRedelivered}/${shop.emailsRetried} retried email(s) delivered${detail}`,
  );
  if (shop.error) failures.push(shop.shop);
}

// Queued and delivered are reported apart: a Resend outage still creates a
// reminder row per request, so a single count would claim success either way.
console.log(
  `Ran at ${result.ranAt}: ${shops.length} shop(s), ${expired} offer(s) expired, ` +
    `${reminders} of ${queued} reminder(s) delivered, ${redelivered} earlier email(s) redelivered.`,
);

if (failures.length > 0) {
  fail(`Maintenance failed for: ${failures.join(", ")}`);
}
