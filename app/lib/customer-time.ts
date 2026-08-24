export const CUSTOMER_TIME_FALLBACK_ZONE = "UTC";

/**
 * Accepts only a real IANA zone. Never infers one from an IP address.
 */
export function normalizeIanaTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

function formatInZone(
  date: Date,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const zone = normalizeIanaTimeZone(timeZone) ?? CUSTOMER_TIME_FALLBACK_ZONE;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(
    date,
  );
}

const VIEWER_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/** Customer-facing date+time. Unknown zone falls back to labelled UTC. */
export function formatCustomerDateTime(
  date: Date,
  timeZone?: string | null,
): string {
  return formatInZone(date, timeZone, VIEWER_DATE_TIME_OPTIONS);
}

/**
 * Formats an instant in a reader's timezone. Pass an IANA zone in tests;
 * omit it in the browser so Intl uses that viewer's local zone and abbreviation.
 */
export function formatViewerDateTime(
  date: Date | string,
  timeZone?: string | null,
): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (!Number.isFinite(value.getTime())) return "";
  const zone = normalizeIanaTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    ...VIEWER_DATE_TIME_OPTIONS,
    ...(zone ? { timeZone: zone } : {}),
  }).format(value);
}

/** Customer-facing date. Unknown zone falls back to the UTC calendar day. */
export function formatCustomerDate(date: Date, timeZone?: string | null): string {
  return formatInZone(date, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZoneName: "short",
  });
}

export function customerTimeZoneLabel(timeZone?: string | null): string {
  return normalizeIanaTimeZone(timeZone) ?? CUSTOMER_TIME_FALLBACK_ZONE;
}
