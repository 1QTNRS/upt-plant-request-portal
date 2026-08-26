export const PUSH_KIND_NEW_REQUEST = "new_request";
export const PUSH_KIND_ITEM_STATUS = "item_status";

export const IOS_ADMIN_SCHEME = "uptadmin";

const EXPO_PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export function isExpoPushToken(value: string): boolean {
  return EXPO_PUSH_TOKEN.test(value.trim());
}

/** Last four characters only — never log the full token. */
export function expoPushTokenHint(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 8) return "(short)";
  return `…${trimmed.slice(-4)}`;
}

export function newRequestPushCopy(input: {
  requestNumber: string;
  customerName: string;
}): { title: string; body: string } {
  return {
    title: "New plant request",
    body: `${input.requestNumber} from ${input.customerName.trim() || "a customer"}`,
  };
}

export function itemStatusPushCopy(input: {
  requestNumber: string;
  acceptedCount: number;
  rejectedCount: number;
}): { title: string; body: string } | null {
  const parts: string[] = [];
  if (input.acceptedCount > 0) {
    parts.push(
      `${input.acceptedCount} accepted`,
    );
  }
  if (input.rejectedCount > 0) {
    parts.push(
      `${input.rejectedCount} rejected`,
    );
  }
  if (parts.length === 0) return null;
  return {
    title: "Item status update",
    body: `${input.requestNumber}: ${parts.join(", ")}`,
  };
}

export function adminPushIdempotencyKey(
  kind: typeof PUSH_KIND_NEW_REQUEST | typeof PUSH_KIND_ITEM_STATUS,
  requestId: string,
): string {
  return `${kind}:${requestId}`;
}

export function iosAdminRequestPath(requestId: string): string {
  return `/request/${requestId}`;
}

export function iosAdminRequestUrl(requestId: string): string {
  return `${IOS_ADMIN_SCHEME}:/${iosAdminRequestPath(requestId)}`;
}

export function requestIdFromAdminPushData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const value = data?.requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A notification tap may only open a request after the device is still
 * signed in with a live upt_admin_ token. Logged-out or revoked devices
 * keep the pending id until that check succeeds.
 */
export function resolveAdminPushDeepLink(input: {
  signedIn: boolean;
  requestId: string | null;
}): { openRequestId: string | null; pendingRequestId: string | null } {
  if (!input.requestId) {
    return { openRequestId: null, pendingRequestId: null };
  }
  if (!input.signedIn) {
    return { openRequestId: null, pendingRequestId: input.requestId };
  }
  return { openRequestId: input.requestId, pendingRequestId: null };
}
