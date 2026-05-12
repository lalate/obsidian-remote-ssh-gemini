import { describe, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import type { Vault } from 'obsidian';
import { SftpDataAdapter } from '../../src/adapter/SftpDataAdapter';
import { RpcRemoteFsClient } from '../../src/adapter/RpcRemoteFsClient';
import { ReadCache } from '../../src/cache/ReadCache';
import { DirCache } from '../../src/cache/DirCache';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { deployTestDaemon, LOCAL_DAEMON_BINARY, type DeployedDaemon } from './helpers/deployDaemonOnce';
import { buildRpcClient, type RpcClientHandle } from './helpers/multiclientRpc';
import { TEST_PRIVATE_KEY } from './helpers/makeAdapter';
import { assertSelfReflect } from './helpers/assertSelfReflect';
import { HarnessVault, asArrayBuffer } from './helpers/harnessVault';
import { expectFailingWithShape } from './helpers/expectFailingWithShape';

/**
 * Layer 1 (extended) — writer self-reflect over **RPC transport**.
 *
 * Companion to `self-reflect.e2e.test.ts`. That file exercises the
 * SFTP transport, where the bug is permanent (no daemon → no
 * `fs.watch` push to recover via). This file exercises the RPC
 * transport, where the daemon push could in principle paper over
 * the missing reflect — but only if the writer-side wiring exists
 * to translate `fs.changed` notifications into local vault triggers.
 *
 * Today the wiring does NOT exist on the writer side (it exists on
 * reader clients via `handleFsChangedForReader` in
 * `sync.e2e.test.ts`, mirroring main.ts's reader-only wiring), so
 * the bug surfaces on RPC too. The cases below use `it.fails(...)`
 * to document that contract.
 *
 * The production fix that removes `.fails` here should be the same
 * fix that removes `.fails` from the SFTP test — namely, having the
 * adapter fire `vault.trigger` directly after a successful op, so
 * transport choice doesn't matter for self-reflect correctness.
 *
 * Runs only when both the test keypair AND the daemon binary are
 * staged (`npm run sshd:start` + `npm run build:server`).
 */

if (!fs.existsSync(TEST_PRIVATE_KEY)) {
  throw new Error(
    `Integration test keypair missing at ${TEST_PRIVATE_KEY}. ` +
    'Run `npm run sshd:start` from the repo root before `npm run test:integration`.',
  );
}
if (!fs.existsSync(LOCAL_DAEMON_BINARY)) {
  throw new Error(
    `Daemon binary missing at ${LOCAL_DAEMON_BINARY}. ` +
    'Run `npm run build:server` before `npm run test:integration`.',
  );
}

const PER_CASE_BUDGET_MS = 3_000;

describe('Layer 1 — writer self-reflect (RPC transport)', () => {
  let daemon: DeployedDaemon;
  let writer: RpcClientHandle;
  let writerAdapter: SftpDataAdapter;
  let writerVault: HarnessVault;
  let fakeFE: FakeFileExplorer;
  let detachFE: (() => void) | null = null;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const subdirRel = `srpc-${stamp}`;

  beforeAll(async () => {
    daemon = await deployTestDaemon({ label: 'srpc' });
    writer = await buildRpcClient(daemon.result.remoteSocketPath, daemon.result.token, 'srpc-writer');

    writerAdapter = new SftpDataAdapter(
      new RpcRemoteFsClient(writer.conn.rpc),
      '',
      new ReadCache({ maxBytes: 64 * 1024 * 1024 }),
      new DirCache(),
      'srpc-writer',
    );

    writerVault = new HarnessVault();
    fakeFE = new FakeFileExplorer();
    detachFE = fakeFE.attach(writerVault as unknown as Vault);

    // Pre-create the subdir so each case can write into it. This is
    // a setup write, NOT a tested op — its outcome on the writer's
    // FakeFileExplorer is irrelevant.
    await writerAdapter.mkdir(subdirRel);
  });

  afterAll(async () => {
    try { detachFE?.(); } catch { /* best effort */ }
    try { await writer.close(); } catch { /* best effort */ }
    if (daemon) await daemon.teardown();
  });

  it('write — TODAY: RPC adapter.write does NOT fire vault.trigger("create") (#341)', async () => {
    const target = `${subdirRel}/note-write.bin`;
    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'rpc:write->create',
        op: () => writerAdapter.writeBinary(target, asArrayBuffer(Buffer.from('hello-rpc'))),
        fakeFE,
        expect: { path: target, event: 'create' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — RPC write self-reflect missing',
    );
  });

  it('modify — TODAY: RPC adapter.write (overwrite) does NOT fire vault.trigger("modify") (#341)', async () => {
    const target = `${subdirRel}/note-modify.bin`;
    await writerAdapter.writeBinary(target, asArrayBuffer(Buffer.from('v1')));
    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'rpc:write->modify',
        op: () => writerAdapter.writeBinary(target, asArrayBuffer(Buffer.from('v2'))),
        fakeFE,
        expect: { path: target, event: 'modify' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — RPC modify self-reflect missing',
    );
  });

  it('rename — TODAY: RPC adapter.rename does NOT fire vault.trigger("rename") (#341)', async () => {
    const oldPath = `${subdirRel}/note-rename-src.bin`;
    const newPath = `${subdirRel}/note-rename-dst.bin`;
    await writerAdapter.writeBinary(oldPath, asArrayBuffer(Buffer.from('renamed')));
    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'rpc:rename',
        op: () => writerAdapter.rename(oldPath, newPath),
        fakeFE,
        expect: { path: newPath, event: 'rename' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — RPC rename self-reflect missing (proves bug not SFTP-only)',
    );
  });

  it('delete — TODAY: RPC adapter.remove does NOT fire vault.trigger("delete") (#341)', async () => {
    const target = `${subdirRel}/note-delete.bin`;
    await writerAdapter.writeBinary(target, asArrayBuffer(Buffer.from('to-delete')));
    await expectFailingWithShape(
      () => assertSelfReflect({
        label: 'rpc:delete',
        op: () => writerAdapter.remove(target),
        fakeFE,
        expect: { path: target, event: 'delete' },
        budgetMs: PER_CASE_BUDGET_MS,
      }),
      /awaitReflect failed/,
      '#341 — RPC delete self-reflect missing',
    );
  });
});
