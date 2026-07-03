import type { BulkWalker } from './BulkWalker';
import type { VaultModelBuilder } from './VaultModelBuilder';
import { logger } from '../util/logger';
import { errorMessage } from '../util/errorMessage';

/**
 * Loads the remote vault tree ONE folder level at a time, on demand, instead
 * of walking + materialising the whole (deep, dir-heavy) tree at connect.
 *
 * Connect does a shallow populate (root's immediate children). Every folder is
 * materialised as an initially childless `TFolder` — Obsidian still renders an
 * expand arrow for a childless folder (verified in a real-Obsidian spike:
 * `nav-folder-title` gets `mod-collapsible` + a collapse-icon regardless of
 * child count), so the user can open it. A File-Explorer folder-expand click
 * (wired in `main.ts`, since Obsidian renders from the in-memory model and
 * does NOT call `adapter.list` on expand) calls {@link loadFolder}, which
 * walks just that folder and materialises its children; their own subfolders
 * stay unloaded until expanded in turn.
 *
 * `walkIgnoreDirs` is honoured per level (the walker carries it), so ignore
 * pruning and lazy depth-limiting compose. The live `fs.changed` watch keeps
 * working against a partially-loaded tree because inserts `ensureParents`.
 *
 * Idempotent + deduped: re-expanding a loaded folder is a no-op, and two
 * near-simultaneous expands of the same folder share one walk.
 */
export class LazyFolderLoader {
  private readonly loaded = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    /** Fresh walker per load — mirrors how the connect populate builds one. */
    private readonly makeWalker: () => BulkWalker,
    /** Fresh (stateless) builder per load. */
    private readonly makeBuilder: () => VaultModelBuilder,
  ) {}

  /** Mark a path as already loaded (the root, after the connect shallow populate). */
  markLoaded(path: string): void {
    this.loaded.add(path);
  }

  /** Drop all lazy state (on disconnect / re-patch). */
  reset(): void {
    this.loaded.clear();
    this.inFlight.clear();
  }

  isLoaded(path: string): boolean {
    return this.loaded.has(path);
  }

  /**
   * Materialise `folderPath`'s immediate children (one level). Resolves once
   * they're in the vault model. No-op if the folder was already loaded; a
   * concurrent load of the same folder shares one walk. A failed load leaves
   * the folder unloaded so a later expand retries.
   */
  loadFolder(folderPath: string): Promise<void> {
    if (this.loaded.has(folderPath)) return Promise.resolve();
    const existing = this.inFlight.get(folderPath);
    if (existing) return existing;
    const p = this.doLoad(folderPath);
    this.inFlight.set(folderPath, p);
    return p.finally(() => this.inFlight.delete(folderPath));
  }

  private async doLoad(folderPath: string): Promise<void> {
    try {
      const walk = await this.makeWalker().walk(folderPath, false); // one level only
      const result = await this.makeBuilder().buildChunked(walk.entries);
      this.loaded.add(folderPath);
      logger.info(
        `LazyFolderLoader: loaded "${folderPath}" — ${result.filesAdded}f + ${result.foldersAdded}d ` +
        `(${result.skipped} already present)`,
      );
    } catch (e) {
      logger.warn(`LazyFolderLoader: load "${folderPath}" failed (${errorMessage(e)}); will retry on next expand`);
    }
  }
}
