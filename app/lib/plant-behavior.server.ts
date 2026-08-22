import prisma from "../db.server";
import {
  daysBetween,
  plantBehaviorPatterns,
  REPEATED_DECLINE_WINDOW_DAYS,
  type CanonicalPlantActivity,
  type PlantBehaviorPattern,
} from "./plant-behavior";
import { backfillCanonicalPlants } from "./plant-identity.server";

export type CustomerPlantPatterns = {
  email: string;
  customerName: string;
  patterns: PlantBehaviorPattern[];
};

type ActivityAccumulator = {
  canonicalPlantId: string;
  displayName: string;
  requestedNames: Set<string>;
  timesRequested: number;
  timesOffered: number;
  timesDeclined: number;
  timesPurchased: number;
  timesExpired: number;
  firstRequestAt: Date;
  mostRecentRequestAt: Date;
};

function windowStart(now: Date, windowDays: number): Date {
  const start = new Date(now);
  start.setDate(start.getDate() - windowDays);
  return start;
}

function finish(entry: ActivityAccumulator): CanonicalPlantActivity {
  return {
    canonicalPlantId: entry.canonicalPlantId,
    displayName: entry.displayName,
    requestedNames: [...entry.requestedNames].sort(),
    timesRequested: entry.timesRequested,
    timesOffered: entry.timesOffered,
    timesDeclined: entry.timesDeclined,
    timesPurchased: entry.timesPurchased,
    timesExpired: entry.timesExpired,
    rangeDays: daysBetween(entry.firstRequestAt, entry.mostRecentRequestAt),
    mostRecentRequestAt: entry.mostRecentRequestAt,
  };
}

/**
 * Every request line in the window that has an identity, with enough of the
 * offer, the answer and the payment to say what became of it.
 */
async function activityRows(shop: string, since: Date) {
  return prisma.requestItem.findMany({
    where: {
      canonicalPlantId: { not: null },
      request: { shop, submittedAt: { gte: since } },
    },
    select: {
      plantName: true,
      canonicalPlantId: true,
      canonicalPlant: { select: { displayName: true } },
      request: {
        select: {
          id: true,
          customerEmail: true,
          customerName: true,
          submittedAt: true,
          status: true,
          paidAt: true,
        },
      },
      offerItems: { select: { availability: true } },
      responseItems: { select: { choice: true } },
    },
  });
}

/**
 * Per-plant history for every customer of a shop, keyed by lowercased email —
 * the same key the customer rows in analytics are grouped on.
 *
 * The backfill runs first so a shop whose rows predate canonical identity is not
 * silently reported as having no patterns.
 */
export async function customerPlantActivity(
  shop: string,
  options: { now?: Date; windowDays?: number } = {},
): Promise<Map<string, { customerName: string; activities: CanonicalPlantActivity[] }>> {
  await backfillCanonicalPlants(shop);

  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? REPEATED_DECLINE_WINDOW_DAYS;
  const rows = await activityRows(shop, windowStart(now, windowDays));

  const byCustomer = new Map<
    string,
    { customerName: string; plants: Map<string, ActivityAccumulator> }
  >();

  for (const row of rows) {
    if (!row.canonicalPlantId) continue;
    const email = row.request.customerEmail.toLowerCase();
    const customer =
      byCustomer.get(email) ??
      { customerName: row.request.customerName, plants: new Map() };

    const entry =
      customer.plants.get(row.canonicalPlantId) ??
      ({
        canonicalPlantId: row.canonicalPlantId,
        displayName: row.canonicalPlant?.displayName ?? row.plantName,
        requestedNames: new Set<string>(),
        timesRequested: 0,
        timesOffered: 0,
        timesDeclined: 0,
        timesPurchased: 0,
        timesExpired: 0,
        firstRequestAt: row.request.submittedAt,
        mostRecentRequestAt: row.request.submittedAt,
      } satisfies ActivityAccumulator);

    entry.requestedNames.add(row.plantName.trim() || row.plantName);
    entry.timesRequested += 1;

    // Only a plant UPT actually offered was ever the customer's to turn down;
    // UPT Not Available is not a decline.
    const offered = row.offerItems.some(
      (item) => item.availability === "available",
    );
    if (offered) entry.timesOffered += 1;

    const declined = row.responseItems.some((item) => item.choice === "reject");
    const accepted = row.responseItems.some((item) => item.choice === "accept");
    if (declined) entry.timesDeclined += 1;
    if (accepted && row.request.paidAt) entry.timesPurchased += 1;
    if (offered && !declined && !accepted && row.request.status === "Expired") {
      entry.timesExpired += 1;
    }

    if (row.request.submittedAt < entry.firstRequestAt) {
      entry.firstRequestAt = row.request.submittedAt;
    }
    if (row.request.submittedAt > entry.mostRecentRequestAt) {
      entry.mostRecentRequestAt = row.request.submittedAt;
    }

    customer.plants.set(row.canonicalPlantId, entry);
    byCustomer.set(email, customer);
  }

  const result = new Map<
    string,
    { customerName: string; activities: CanonicalPlantActivity[] }
  >();
  for (const [email, customer] of byCustomer) {
    result.set(email, {
      customerName: customer.customerName,
      activities: [...customer.plants.values()].map(finish),
    });
  }
  return result;
}

export async function customerPlantPatterns(
  shop: string,
  options: { now?: Date; windowDays?: number } = {},
): Promise<CustomerPlantPatterns[]> {
  const activity = await customerPlantActivity(shop, options);
  const windowDays = options.windowDays ?? REPEATED_DECLINE_WINDOW_DAYS;

  return [...activity.entries()]
    .map(([email, customer]) => ({
      email,
      customerName: customer.customerName,
      patterns: plantBehaviorPatterns(customer.activities, windowDays),
    }))
    .filter((row) => row.patterns.length > 0);
}

/**
 * The patterns worth showing beside one request: only those for a plant this
 * request actually asked for, so the page says something about what the admin is
 * looking at rather than restating the customer's whole file.
 */
export async function requestPlantPatterns(
  shop: string,
  requestId: string,
  options: { now?: Date; windowDays?: number } = {},
): Promise<PlantBehaviorPattern[]> {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    select: {
      customerEmail: true,
      items: { select: { canonicalPlantId: true } },
    },
  });
  if (!request) return [];

  const activity = await customerPlantActivity(shop, options);
  const forCustomer = activity.get(request.customerEmail.toLowerCase());
  if (!forCustomer) return [];

  // Read after the backfill, which may have been what gave these rows an
  // identity in the first place.
  const identities = new Set(
    (
      await prisma.requestItem.findMany({
        where: { requestId },
        select: { canonicalPlantId: true },
      })
    ).flatMap((item) => (item.canonicalPlantId ? [item.canonicalPlantId] : [])),
  );

  return plantBehaviorPatterns(
    forCustomer.activities.filter((entry) =>
      identities.has(entry.canonicalPlantId),
    ),
    options.windowDays ?? REPEATED_DECLINE_WINDOW_DAYS,
  );
}
