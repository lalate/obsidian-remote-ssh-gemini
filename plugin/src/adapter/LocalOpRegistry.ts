/**
 * Short-lived record of vault paths the local writer just mutated, so
 * the RPC `FsChangeListener` can recognise — and drop — the daemon's
 * `fs.watch` echo of our *own* op (#341).
 *
 * Why this exists: on the RPC transport the adapter now reflects a
 * write/rename/remove into the writer's vault model *immediately*
 * (synchronous, race-free). The daemon still observes the same
 * filesystem change and pushes an `fs.changed` frame back; without
 * de-dup, `FsChangeListener` would apply that echo and fire a second
 * `vault.trigger(...)` for an op already reflected — a duplicate
 * create/modify/rename on File Explorer + MetadataCache.
 *
 * The writer records its op paths here *synchronously*, immediately
 * after the remote call returns. The daemon's echo can only arrive
 * after it has observed the change on disk, which is strictly later —
 * so there is no window where the echo races ahead of the record.
 *
 * Other clients' changes never pass through `record`, so their
 * echoes are never suppressed: multi-client propagation is unaffected.
 *
 * Trade-off: an entry lives for `ttlMs`. If a *different* client
 * mutates the exact same path within that window, that genuine
 * external change's echo is also suppressed. This is rare (same path,
 * sub-`ttlMs`, cross-client) and self-heals — the next external
 * change after the TTL applies normally, and a full re-populate would
 * reconcile it. Suppressing our own duplicate is the priority; the
 * default TTL is generous so a slow SSH-tunnelled push is still
 * caught, accepting that rare-collision cost.
 */
export class LocalOpRegistry {
  /** path → epoch-ms after which the entry is stale. */
  private readonly seen = new Map<string, number>();

  /**
   * @param ttlMs how long a recorded path stays "self-originated".
   *   Default 5000ms: comfortably longer than a daemon fs.watch
   *   detection + SSH-tunnelled unix-socket push round-trip, while
   *   short enough that the rare same-path cross-client collision
   *   self-heals quickly.
   */
  constructor(private readonly ttlMs: number = 5_000) {}

  /**
   * Mark `paths` as just-mutated-by-us. Call synchronously right
   * after the remote op succeeds (rename records both old + new).
   * Opportunistically prunes expired entries so the map stays small.
   */
  record(paths: readonly string[]): void {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    for (const [p, exp] of this.seen) {
      if (exp <= now) this.seen.delete(p);
    }
    for (const p of paths) this.seen.set(p, expiresAt);
  }

  /**
   * True if `path` was recorded by `record` and the entry has not yet
   * expired. Does NOT consume the entry: a single op can echo as more
   * than one event (e.g. some watchers split a rename into
   * delete+create), so the entry must stay live for the whole TTL to
   * suppress every echo of that op. The entry is reaped lazily by a
   * later `record`, or here when found stale.
   */
  isSelfOriginated(path: string): boolean {
    const expiresAt = this.seen.get(path);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.seen.delete(path);
      return false;
    }
    return true;
  }
}
