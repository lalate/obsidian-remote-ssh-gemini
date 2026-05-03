/**
 * Tracks in-flight large file transfers (>1 MB) so the UI can show
 * the user something is happening during slow uploads / downloads.
 *
 * No real chunked progress yet — that would need wire-protocol changes
 * (`fs.writeBinaryStream` etc.). For now we only know start + end +
 * elapsed time + total size. The UI shows elapsed seconds so a
 * stalled session is distinguishable from a 30-second 50 MB write.
 */

export type TransferDirection = 'up' | 'down';

export interface Transfer {
  /** Stable identifier for `end()` lookups. */
  id: string;
  direction: TransferDirection;
  /** Vault-relative path being transferred. */
  path: string;
  /** Total byte count of the payload. */
  bytes: number;
  /** Wall-clock ms when the transfer began (for elapsed display). */
  startedAtMs: number;
}

export type TransferListener = (transfers: Transfer[]) => void;

export class TransferTracker {
  /** Lower bound on payload size; transfers below this are silent. */
  static readonly THRESHOLD_BYTES = 1024 * 1024; // 1 MB

  private readonly inFlight = new Map<string, Transfer>();
  private readonly listeners = new Set<TransferListener>();
  private seq = 0;

  /**
   * Register a transfer. Returns the id to pass back to `end()`.
   * Returns `null` if `bytes` is below the threshold — the caller
   * doesn't need to wrap small transfers in begin/end at all.
   */
  begin(direction: TransferDirection, path: string, bytes: number): string | null {
    if (bytes < TransferTracker.THRESHOLD_BYTES) return null;
    const id = `${direction}-${++this.seq}`;
    this.inFlight.set(id, {
      id,
      direction,
      path,
      bytes,
      startedAtMs: Date.now(),
    });
    this.notify();
    return id;
  }

  /** Remove a transfer. No-op if `id` is null (matches begin's return). */
  end(id: string | null): void {
    if (!id) return;
    if (this.inFlight.delete(id)) {
      this.notify();
    }
  }

  /** Snapshot of currently-in-flight transfers (read-only). */
  snapshot(): Transfer[] {
    return [...this.inFlight.values()];
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: TransferListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Drop all transfers. Used on disconnect / restoreAdapter. */
  clear(): void {
    if (this.inFlight.size === 0) return;
    this.inFlight.clear();
    this.notify();
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const fn of [...this.listeners]) {
      try { fn(snap); } catch { /* listener crash must not break tracker */ }
    }
  }
}
