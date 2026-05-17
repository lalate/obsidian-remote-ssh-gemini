import { describe, it, expect, vi } from 'vitest';
import { RenameLeafFollower } from '../src/vault/RenameLeafFollower';

/**
 * Harness: `isPathOpen` returns the next queued boolean per call so a
 * test can model "open before the rename, dropped after Obsidian's
 * crash" as `[true, false]`. `defer` queues callbacks the test flushes
 * explicitly, proving the repair runs AFTER the call stack unwinds
 * (i.e. after Obsidian's reconcile crash), not synchronously.
 */
function harness(openSeq: boolean[], active = true) {
  const reopened: string[] = [];
  const deferred: Array<() => void> = [];
  let i = 0;
  const follower = new RenameLeafFollower(
    {
      isPathOpen: () => openSeq[Math.min(i++, openSeq.length - 1)],
      reopen: (p) => reopened.push(p),
    },
    () => active,
    (cb) => { deferred.push(cb); },
  );
  return {
    follower,
    reopened,
    flush: () => { for (const cb of deferred.splice(0)) cb(); },
    deferredCount: () => deferred.length,
  };
}

describe('RenameLeafFollower', () => {
  it('re-opens the file when Obsidian drops the tab on rename (open→dropped)', () => {
    const h = harness([/* before */ true, /* after crash */ false]);
    h.follower.handleRename({ path: 'notes/renamed.md' });

    // Nothing happens synchronously — the repair must wait until the
    // rename + Obsidian's reconcile crash have unwound.
    expect(h.reopened).toEqual([]);
    expect(h.deferredCount()).toBe(1);

    h.flush();
    expect(h.reopened).toEqual(['notes/renamed.md']);
  });

  it('is a no-op on a healthy build where the tab survives (open→open)', () => {
    const h = harness([true, true]);
    h.follower.handleRename({ path: 'a.md' });
    h.flush();
    expect(h.reopened).toEqual([]); // native follow held — must not double-open
  });

  it('does not spuriously open a file that was not open before the rename', () => {
    const h = harness([false]);
    h.follower.handleRename({ path: 'closed.md' });
    expect(h.deferredCount()).toBe(0); // bailed before scheduling
    h.flush();
    expect(h.reopened).toEqual([]);
  });

  it('is fully inert when the patched adapter is not active', () => {
    const isOpen = vi.fn(() => true);
    const reopened: string[] = [];
    const deferred: Array<() => void> = [];
    const follower = new RenameLeafFollower(
      { isPathOpen: isOpen, reopen: (p) => reopened.push(p) },
      () => false, // not connected — normal local vault
      (cb) => { deferred.push(cb); },
    );
    follower.handleRename({ path: 'x.md' });
    expect(isOpen).not.toHaveBeenCalled(); // doesn't even probe the workspace
    expect(deferred).toHaveLength(0);
    expect(reopened).toEqual([]);
  });
});
