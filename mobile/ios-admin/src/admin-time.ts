/** Admin-facing note stamp in Pacific Time: Sep 8, 2026 · 3:24 PM PT */
const PORTAL_DISPLAY_TIME_ZONE = "America/Los_Angeles";

export function formatAdminNoteTimestamp(iso: string): string {
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

export function formatPortalDateTime(iso: string): string {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(value);
}
