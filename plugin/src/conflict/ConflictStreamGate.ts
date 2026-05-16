let activeUntil = 0;

const DEFAULT_PULSE_MS = 1200;

// Pulse marks stream activity for a short window. Repeated pulses keep the gate active.
export function pulseConflictStreamActivity(windowMs: number = DEFAULT_PULSE_MS): void {
  activeUntil = Math.max(activeUntil, Date.now() + Math.max(100, windowMs));
}

export function isConflictStreamBusy(): boolean {
  return Date.now() < activeUntil;
}

export function clearConflictStreamActivity(): void {
  activeUntil = 0;
}
