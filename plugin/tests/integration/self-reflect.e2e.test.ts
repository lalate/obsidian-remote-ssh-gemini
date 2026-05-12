import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import type { Vault } from 'obsidian';
import { VaultModelBuilder, type ObsidianClassDeps } from '../../src/vault/VaultModelBuilder';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { assertSelfReflect } from './helpers/assertSelfReflect';
import { HarnessVault, HarnessTFile, HarnessTFolder, asArrayBuffer } from './helpers/harnessVault';

/**
 * Layer 1 of the sync-test framework — **writer self-reflect**.
 *
 * Each case follows the same pattern:
 *
 *   1. The writer's adapter performs a mutation (rename / write /
 *      delete / create).
 *   2. A FakeFileExplorer attached to the *writer's* vault is
 *      expected to observe the corresponding `vault.trigger(...)`
 *      event within the budget.
 *
 * Real Obsidian holds `TFile` references through that same event
 * stream (File Explorer, MetadataCache, editor tabs, plugins).
 * Issue #341 is exactly the case where this self-reflect is missing
 * for rename: the title-bar rename in Obsidian calls
 * `adapter.rename(old, new)` against our patched adapter, the
 * remote SSH op succeeds, but no `vault.trigger('rename', ...)`
 * fires on the writer side, so open editor tabs stay bound to the
 * old path.
 *
 * The cases below are written with `it.fails(...)` — they assert
 * what the contract should be, and the helper will throw on timeout
 * because no reflect arrives today. When the fix lands (the patched
 * adapter starts mirroring its mutations into the writer's vault
 * model), removing the `.fails` marker is part of that PR.
 *
 * Transport coverage: SFTP only for now. The bug is permanent on
 * SFTP (no daemon → no `fs.watch` push to recover via). On RPC the
 * `FsChangeListener` path eventually papers over the missing reflect
 * via a daemon push, but on a race that is itself a bug — we'll add
 * the RPC variant once the SFTP cases turn green.
 *
 * Runs only when the test keypair is staged (`npm run sshd:start`).
 */

if (!fs.existsSync(TEST_PRIVATE_KEY)) {
  throw new Error(
    `Integration test keypair missing at ${TEST_PRIVATE_KEY}. ` +
    'Run `npm run sshd:start` from the repo root before `npm run test:integration`.',
  );
}

// Per-case budget: a single SSH round-trip + adapter bookkeeping +
// the synchronous vault.trigger should easily fit in 1.5s. Generous
// enough to avoid CI flakes on slow runners; tight enough that a
// missing trigger (the actual bug) shows up as a timeout failure
// rather than a stuck test.
const PER_CASE_BUDGET_MS = 1_500;

describe('Layer 1 — writer self-reflect (SFTP transport)', () => {
  let pair: Awaited<ReturnType<typeof setupClientPair>>;
  let writer: TestClient;
  let writerVault: HarnessVault;
  let fakeFE: FakeFileExplorer;
  let detachFE: (() => void) | null = null;
  let builder: VaultModelBuilder;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    pair = await setupClientPair({ testLabel: 'self-reflect' });
    writer = pair.a;

    writerVault = new HarnessVault();
    fakeFE = new FakeFileExplorer();
    detachFE = fakeFE.attach(writerVault as unknown as Vault);

    builder = new VaultModelBuilder(
      writerVault as unknown as Vault,
      { TFile: HarnessTFile as unknown as ObsidianClassDeps['TFile'],
        TFolder: HarnessTFolder as unknown as ObsidianClassDeps['TFolder'] },
    );
    // Silence the unused-variable check; builder is held for future
    // cases that may want to seed state synthetically when a fix
    // hasn't landed yet.
    void builder;
  });

  afterAll(async () => {
    try { detachFE?.(); } catch { /* best effort */ }
    if (pair) await pair.cleanup();
  });

  // ── #341 regression cases — currently all expected to fail ────────────

  it.fails('write — adapter.write fires vault.trigger("create") on writer', async () => {
    const target = `note-write-${stamp}.bin`;
    await assertSelfReflect({
      label: 'write->create',
      op: () => writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('hello'))),
      fakeFE,
      expect: { path: target, event: 'create' },
      budgetMs: PER_CASE_BUDGET_MS,
    });
  });

  it.fails('modify — adapter.write on an existing path fires vault.trigger("modify")', async () => {
    const target = `note-modify-${stamp}.bin`;
    // Setup: pre-create so the second write is a modify, not a create.
    // Use the adapter so the bug surface is consistent with how a real
    // Obsidian write would land.
    await writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('v1')));

    await assertSelfReflect({
      label: 'write->modify',
      op: () => writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('v2'))),
      fakeFE,
      expect: { path: target, event: 'modify' },
      budgetMs: PER_CASE_BUDGET_MS,
    });
  });

  it.fails('rename — adapter.rename fires vault.trigger("rename") on writer (issue #341)', async () => {
    const oldPath = `note-rename-src-${stamp}.bin`;
    const newPath = `note-rename-dst-${stamp}.bin`;
    await writer.adapter.writeBinary(oldPath, asArrayBuffer(Buffer.from('renamed')));

    await assertSelfReflect({
      label: 'rename',
      op: () => writer.adapter.rename(oldPath, newPath),
      fakeFE,
      expect: { path: newPath, event: 'rename' },
      budgetMs: PER_CASE_BUDGET_MS,
    });
  });

  it.fails('delete — adapter.remove fires vault.trigger("delete") on writer', async () => {
    const target = `note-delete-${stamp}.bin`;
    await writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('to-delete')));

    await assertSelfReflect({
      label: 'delete',
      op: () => writer.adapter.remove(target),
      fakeFE,
      expect: { path: target, event: 'delete' },
      budgetMs: PER_CASE_BUDGET_MS,
    });
  });

  // ── post-mutation snapshot invariants (independent of timing) ─────────
  //
  // Once the fix lands and the `.fails` markers come off above, these
  // become natural follow-up assertions. Kept here under `it.fails` so
  // the suite documents the full intended contract today.

  it.fails('post-rename — writer.vault.fileMap reflects the new path, not the old', async () => {
    const oldPath = `note-fmap-src-${stamp}.bin`;
    const newPath = `note-fmap-dst-${stamp}.bin`;
    await writer.adapter.writeBinary(oldPath, asArrayBuffer(Buffer.from('m')));
    await writer.adapter.rename(oldPath, newPath);

    // Give the writer-side reflect path a moment — once the fix lands
    // this should be synchronous, but a microtask flush is cheap and
    // makes the assertion future-proof.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(writerVault.getAbstractFileByPath(newPath)).not.toBeNull();
    expect(writerVault.getAbstractFileByPath(oldPath)).toBeNull();
  });
});
