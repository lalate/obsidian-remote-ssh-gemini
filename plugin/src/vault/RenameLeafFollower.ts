import { logger } from '../util/logger';

/**
 * Narrow workspace surface this follower needs. main.ts adapts the
 * real `app.workspace`; unit tests pass a fake — so this stays
 * decoupled from Obsidian's runtime classes (the test-side obsidian
 * mock exports `TFile` as a type alias, not a constructor, so an
 * `instanceof TFile` here would be untestable).
 */
export interface RenameFollowWorkspace {
  /** True if some markdown editor leaf currently shows the file at `path`. */
  isPathOpen(path: string): boolean;
  /** Re-open the file at `path` in a tab (restores a tab Obsidian dropped). */
  reopen(path: string): void;
}

/**
 * Keeps the open editor tab on a renamed file (#341 follow-up).
 *
 * A writer rename reflects correctly into `vault.fileMap`
 * (`VaultModelBuilder.renameOne` preserves the `TFile` identity and
 * fires `vault.trigger('rename', file, oldPath)`), but Obsidian's own
 * post-adapter `Vault.rename` reconcile (`reconcileFile`) crashes on
 * this Obsidian build — the documented "iu/nu …startsWith" throw, see
 * the `FsChangeListener.applyChange` JSDoc — which aborts
 * `FileManager.renameFile`'s editor-follow and leaves the open tab
 * orphaned. Symptom: the file is renamed (model updated) but the tab
 * closes and must be reopened.
 *
 * Our `renameOne` runs synchronously inside our own
 * `vault.trigger('rename')`, which is *before* Obsidian's reconcile
 * crash later in the same call stack — so this handler observes the
 * tab still alive. It records that the file was open, then after the
 * call stack unwinds (the crash included) checks whether Obsidian
 * dropped the tab and, if so, re-opens the file. Idempotent: on a
 * healthy build the native follow keeps the tab and this is a no-op.
 *
 * Gated by `isActive` (the patched adapter being installed) so a
 * normal, unconnected local vault's rename behaviour is never touched.
 */
export class RenameLeafFollower {
  constructor(
    private readonly ws: RenameFollowWorkspace,
    private readonly isActive: () => boolean,
    /** Run `cb` after the current call stack (incl. Obsidian's reconcile). */
    private readonly defer: (cb: () => void) => void,
  ) {}

  /** Bind to `vault.on('rename', …)`. `file` is the renamed entry. */
  handleRename = (file: { path: string }): void => {
    if (!this.isActive()) return;
    // `file.path` is already the NEW path (renameOne mutated it before
    // firing the event); the still-open leaf holds the same TFile, so
    // it reports the new path too. A folder never shows in a markdown
    // leaf, so `isPathOpen` is false for one — no folder filter needed.
    const path = file.path;
    if (!this.ws.isPathOpen(path)) return; // not open → nothing to protect
    this.defer(() => {
      if (this.ws.isPathOpen(path)) return; // native follow held — no-op
      logger.info(
        `RenameLeafFollower: Obsidian dropped the editor tab on rename; ` +
        `re-opening "${path}"`,
      );
      this.ws.reopen(path);
    });
  };
}
