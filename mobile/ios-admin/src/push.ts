export const IOS_ADMIN_SCHEME = "uptadmin";

export function iosAdminRequestUrl(requestId: string): string {
  return `${IOS_ADMIN_SCHEME}://request/${requestId}`;
}

export function requestIdFromAdminPushData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const value = data?.requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
