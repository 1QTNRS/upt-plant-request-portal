/** Admin-facing note stamp: Sep 8, 2026 · 3:24 PM in the device locale. */
export function formatAdminNoteTimestamp(iso: string): string {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "";
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  return `${datePart} · ${timePart}`;
}
