export function formatOfferExpirationUrgencyPill(
  expiresAtIso: string,
  now = new Date(),
): string | null {
  const expiresAt = new Date(expiresAtIso);
  const ms = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Expired";

  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 72) return "<3 days";
  if (hours >= 48) return "<3 days";
  if (hours >= 24) return "<2 days";
  if (hours >= 12) return "<1 day";
  if (hours >= 6) return "<12 hrs";
  if (hours >= 2) return "<6 hrs";
  return "<2 hrs";
}

export function isOfferExpired(expiresAtIso: string, now = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}

export function requestShowsAnsweredPill(
  status: string,
  hasResponded: boolean,
): boolean {
  return status === "Pending" && hasResponded;
}
