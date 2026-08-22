/**
 * Internal behaviour patterns, counted per canonical plant.
 *
 * This is analysis for the owner and nobody else. A pattern here never blocks a
 * request, never changes what is offered, never changes a price and is never
 * rendered on a customer-facing page — `app/lib/plant-behavior.test.ts` asserts
 * that no customer route or component can reach this module.
 *
 * Counting per canonical identity rather than per typed name is the whole point:
 * a customer who asked for `Hoya carnosa`, `H. carnosa` and `hoya  carnosa` and
 * turned down all three has asked for one plant three times, and on raw text that
 * reads as three plants asked for once each — which is exactly the case worth
 * knowing about, and exactly the one raw text cannot see.
 */

/**
 * Three asks is where a pattern starts. Two is a coincidence — a customer whose
 * first offer arrived at a bad moment asking again is ordinary — and waiting for
 * four means the owner finds out after sourcing the plant a fourth time.
 */
export const REPEATED_DECLINE_MIN_REQUESTS = 3;

/**
 * Ninety days, so the window is recent behaviour rather than a customer's whole
 * history: three declines spread over two years say nothing, and the same three
 * inside a quarter are a live problem.
 */
export const REPEATED_DECLINE_WINDOW_DAYS = 90;

/**
 * Two declines, not one. A single decline with two unanswered offers is a
 * reachability problem, which `Expired Offer Risk` already covers; two is the
 * customer looking at the plant and saying no.
 */
export const REPEATED_DECLINE_MIN_DECLINES = 2;

/**
 * Any purchase of the plant ends the pattern outright. Someone who declined
 * twice and then bought was being particular, which is not what this is for.
 */
export const REPEATED_DECLINE_MAX_PURCHASES = 0;

export const REPEATED_REQUEST_DECLINE_FLAG = "Repeated Request / Decline Pattern";

/** One customer's history with one canonical plant, inside the window. */
export type CanonicalPlantActivity = {
  canonicalPlantId: string;
  /** The canonical identity's name, not any single customer spelling. */
  displayName: string;
  /** Spellings this customer used, kept so the owner can see the raw text. */
  requestedNames: string[];
  timesRequested: number;
  timesOffered: number;
  timesDeclined: number;
  timesPurchased: number;
  timesExpired: number;
  /** Days from the first request in the window to the most recent. */
  rangeDays: number;
  mostRecentRequestAt: Date;
};

export type PlantBehaviorPattern = {
  flag: typeof REPEATED_REQUEST_DECLINE_FLAG;
  activity: CanonicalPlantActivity;
  /** Admin-facing sentence. Internal only. */
  summary: string;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function describeRepeatedRequestDecline(
  activity: CanonicalPlantActivity,
  windowDays = REPEATED_DECLINE_WINDOW_DAYS,
): string {
  const declines =
    activity.timesDeclined >= activity.timesOffered
      ? `declined all ${plural(activity.timesOffered, "offer")}`
      : `declined ${activity.timesDeclined} of ${plural(activity.timesOffered, "offer")}`;
  const expired =
    activity.timesExpired > 0
      ? ` ${plural(activity.timesExpired, "further offer")} expired unanswered.`
      : "";

  return (
    `This customer requested ${activity.displayName} ${plural(activity.timesRequested, "time")} ` +
    `in the last ${windowDays} days and ${declines}. They have never bought it.${expired}`
  );
}

/**
 * The pattern, or null. Every threshold has to be met: enough asks, enough
 * outright declines, and no purchase at all.
 */
export function repeatedRequestDeclinePattern(
  activity: CanonicalPlantActivity,
  windowDays = REPEATED_DECLINE_WINDOW_DAYS,
): PlantBehaviorPattern | null {
  if (activity.timesRequested < REPEATED_DECLINE_MIN_REQUESTS) return null;
  if (activity.timesDeclined < REPEATED_DECLINE_MIN_DECLINES) return null;
  if (activity.timesPurchased > REPEATED_DECLINE_MAX_PURCHASES) return null;

  return {
    flag: REPEATED_REQUEST_DECLINE_FLAG,
    activity,
    summary: describeRepeatedRequestDecline(activity, windowDays),
  };
}

export function plantBehaviorPatterns(
  activities: CanonicalPlantActivity[],
  windowDays = REPEATED_DECLINE_WINDOW_DAYS,
): PlantBehaviorPattern[] {
  return activities
    .map((activity) => repeatedRequestDeclinePattern(activity, windowDays))
    .filter((pattern): pattern is PlantBehaviorPattern => pattern !== null)
    .sort(
      (left, right) =>
        right.activity.timesRequested - left.activity.timesRequested ||
        right.activity.mostRecentRequestAt.getTime() -
          left.activity.mostRecentRequestAt.getTime(),
    );
}

export function daysBetween(earliest: Date, latest: Date): number {
  const ms = latest.getTime() - earliest.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 86_400_000);
}
