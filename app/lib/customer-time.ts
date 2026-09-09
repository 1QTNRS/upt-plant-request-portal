/** Every user-facing portal timestamp is shown in Pacific Time. Storage stays UTC. */
export const PORTAL_DISPLAY_TIME_ZONE = "America/Los_Angeles";

export const CUSTOMER_TIME_FALLBACK_ZONE = PORTAL_DISPLAY_TIME_ZONE;

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

function formatInPortalZone(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
  }).format(date);
}

const PORTAL_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/** Customer-facing date+time in Pacific Time (PST/PDT). */
export function formatCustomerDateTime(
  date: Date,
  timeZone?: string | null,
): string {
  void timeZone;
  return formatInPortalZone(date, PORTAL_DATE_TIME_OPTIONS);
}

/**
 * Formats an instant for admin and customer display in Pacific Time.
 * The optional zone argument is ignored — display is always Los Angeles.
 */
export function formatViewerDateTime(
  date: Date | string,
  timeZone?: string | null,
): string {
  void timeZone;
  const value = typeof date === "string" ? new Date(date) : date;
  if (!Number.isFinite(value.getTime())) return "";
  return formatInPortalZone(value, PORTAL_DATE_TIME_OPTIONS);
}

/** Customer-facing date in Pacific Time. */
export function formatCustomerDate(date: Date, timeZone?: string | null): string {
  void timeZone;
  return formatInPortalZone(date, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZoneName: "short",
  });
}

export function customerTimeZoneLabel(timeZone?: string | null): string {
  void timeZone;
  return PORTAL_DISPLAY_TIME_ZONE;
}

/** Admin internal-note stamp: Sep 8, 2026 · 3:24 PM PT */
export function formatAdminNoteTimestamp(
  iso: string,
  timeZone?: string | null,
): string {
  void timeZone;
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "";
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
  }).format(value);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(value);
  return `${datePart} · ${timePart}`;
}
