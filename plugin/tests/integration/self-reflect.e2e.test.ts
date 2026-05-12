import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import type { Vault } from 'obsidian';
import { VaultModelBuilder, type ObsidianClassDeps } from '../../src/vault/VaultModelBuilder';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { assertSelfReflect } from './helpers/assertSelfReflect';
import { HarnessVault, HarnessTFile, HarnessTFolder, asArrayBuffer } from './helpers/harnessVault';
import { expectFailingWithShape } from './helpers/expectFailingWithShape';

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
 * The cases below use `expectFailingWithShape(...)` to assert
 * exactly TODAY's failure mode: the helper throws with
 * "awaitReflect failed: ..." because no reflect arrives within
 * budget. That gives us two-way discrimination:
 *
 *   - If the fix lands → no throw → wrapper fails → CI red →
 *     contributor removes the wrapper and asserts success directly.
 *   - If the test infrastructure breaks → throw with a different
 *     shape (TypeError, ECONNRESET, etc.) → wrapper fails → CI red
 *     → contributor diagnoses infra before touching production.
 *
 * `it.fails(...)` would have accepted *any* throw as proof, masking
 * infra bugs as "yes the production bug is still there".
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

  it('write — TODAY: adapter.write does NOT fire vault.trigger("create") (#341)', async () => {
    const target = `note-write-${stamp}.bin`;
    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'write->create',
        op: () => writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('hello'))),
        fakeFE,
        expect: { path: target, event: 'create' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — SFTP write self-reflect missing',
    );
  });

  it('modify — TODAY: adapter.write (overwrite) does NOT fire vault.trigger("modify") (#341)', async () => {
    const target = `note-modify-${stamp}.bin`;
    // Setup: pre-create so the second write is a modify, not a create.
    // Use the adapter so the bug surface is consistent with how a real
    // Obsidian write would land.
    await writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('v1')));

    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'write->modify',
        op: () => writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('v2'))),
        fakeFE,
        expect: { path: target, event: 'modify' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — SFTP modify self-reflect missing',
    );
  });

  it('rename — TODAY: adapter.rename does NOT fire vault.trigger("rename") (#341)', async () => {
    const oldPath = `note-rename-src-${stamp}.bin`;
    const newPath = `note-rename-dst-${stamp}.bin`;
    await writer.adapter.writeBinary(oldPath, asArrayBuffer(Buffer.from('renamed')));

    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'rename',
        op: () => writer.adapter.rename(oldPath, newPath),
        fakeFE,
        expect: { path: newPath, event: 'rename' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — SFTP rename self-reflect missing (the user-facing reproducer)',
    );
  });

  it('delete — TODAY: adapter.remove does NOT fire vault.trigger("delete") (#341)', async () => {
    const target = `note-delete-${stamp}.bin`;
    await writer.adapter.writeBinary(target, asArrayBuffer(Buffer.from('to-delete')));

    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'delete',
        op: () => writer.adapter.remove(target),
        fakeFE,
        expect: { path: target, event: 'delete' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — SFTP delete self-reflect missing',
    );
  });

  // ── post-mutation snapshot invariants (independent of timing) ─────────
  //
  // Companion snapshot view of #341: after rename, vault.fileMap is
  // stale on the writer side. Both assertions below currently fail;
  // we wrap them so the test fails red if/when the bug is fixed (and
  // also red if the helper / setup breaks differently).

  it('post-rename — TODAY: writer.vault.fileMap is unaware of the rename (#341)', async () => {
    const oldPath = `note-fmap-src-${stamp}.bin`;
    const newPath = `note-fmap-dst-${stamp}.bin`;
    await writer.adapter.writeBinary(oldPath, asArrayBuffer(Buffer.from('m')));
    await writer.adapter.rename(oldPath, newPath);

    // Give the writer-side reflect path a moment — once the fix lands
    // this should be synchronous, but a microtask flush is cheap and
    // makes the assertion future-proof.
    await new Promise<void>((r) => setTimeout(r, 50));

    await expectFailingWithShape(
      async () => {
        // Expected post-fix invariant — fails today because no reflect.
        expect(writerVault.getAbstractFileByPath(newPath)).not.toBeNull();
        expect(writerVault.getAbstractFileByPath(oldPath)).toBeNull();
      },
      /to be null|null/i,
      '#341 — SFTP fileMap not updated after rename',
    );
  });
});
