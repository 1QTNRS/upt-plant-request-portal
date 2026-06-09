export const LOCAL_STATE_CHANGED_EVENT = "upt-local-state-changed";

export function notifyLocalStateChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_STATE_CHANGED_EVENT));
}
