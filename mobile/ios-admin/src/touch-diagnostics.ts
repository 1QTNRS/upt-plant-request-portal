export type TouchBlockerRegistration = {
  id: string;
  source: string;
};

let activeBlockers: TouchBlockerRegistration[] = [];

/** Development-only registry of overlays/modals that can steal touches. */
export function registerTouchBlocker(id: string, source: string): () => void {
  if (!__DEV__) return () => undefined;
  activeBlockers = [...activeBlockers, { id, source }];
  console.info("[touch-blocker] mounted", source, activeBlockers.map((row) => row.source));
  return () => {
    activeBlockers = activeBlockers.filter((row) => row.id !== id);
    console.info("[touch-blocker] unmounted", source);
  };
}

export function activeTouchBlockers(): TouchBlockerRegistration[] {
  return [...activeBlockers];
}

export function logActiveTouchBlockers(context: string): void {
  if (!__DEV__) return;
  if (activeBlockers.length === 0) {
    console.info(`[touch-blocker] ${context}: none`);
    return;
  }
  console.warn(
    `[touch-blocker] ${context}:`,
    activeBlockers.map((row) => row.source).join(", "),
  );
}
