import type { ActionResult } from "./types";

/** Clears override-close confirmation once the server accepts or rejects it. */
export function applyAdminActionResult(input: {
  result: ActionResult;
  setError: (value: string | null) => void;
  setConfirmOverride: (value: boolean) => void;
  onSuccess?: () => void;
}): boolean {
  const { result, setError, setConfirmOverride, onSuccess } = input;
  if (!result.ok) {
    setError(result.error || "That action failed.");
    if (result.pendingAdminOverrideClose) setConfirmOverride(true);
    return false;
  }
  setError(null);
  setConfirmOverride(false);
  onSuccess?.();
  return true;
}

/** Detail screens must not carry override-close UI into the next request. */
export function resetRequestDetailTransientState(input: {
  setConfirmOverride: (value: boolean) => void;
  setError: (value: string | null) => void;
}) {
  input.setConfirmOverride(false);
  input.setError(null);
}
