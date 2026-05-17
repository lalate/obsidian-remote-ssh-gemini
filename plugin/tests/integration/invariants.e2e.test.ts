import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import type { Vault } from 'obsidian';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { HarnessVault, asArrayBuffer, makeWriterReflector } from './helpers/harnessVault';
import {
  runScenario,
  formatReport,
  ALL_INVARIANTS,
  INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER,
  INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER,
  type InvariantContext,
  type AdapterOpKind,
} from './helpers/invariants';

/**
 * Layer 3 — invariant scenario runner.
 *
 * Each scenario is a sequence of adapter ops; after every op, the
 * runner checks every invariant in the catalog (`ALL_INVARIANTS`).
 * `it.fails(...)` because today both I1 and I2 are violated by the
 * very first op (SftpDataAdapter doesn't update the writer's vault
 * model — captures #341 from two angles simultaneously).
 *
 * When the fix lands, removing the `.fails` marker becomes part of
 * the fix PR — and any future regression that re-introduces the
 * asymmetry fails the scenario at the exact op that broke it, with
 * the `formatReport` diagnostic naming the violated invariant.
 *
 * The fast-check property-based wrapper (random op sequences +
 * shrinking to a minimal reproducer) is a follow-up RFC. The
 * Invariant interface above is stable across both runners, so the
 * upgrade is additive.
 */

if (!fs.existsSync(TEST_PRIVATE_KEY)) {
  throw new Error(
    `Integration test keypair missing at ${TEST_PRIVATE_KEY}. ` +
    'Run `npm run sshd:start` from the repo root before `npm run test:integration`.',
  );
}

describe('Layer 3 — invariant scenarios', () => {
  let pair: Awaited<ReturnType<typeof setupClientPair>>;
  let writer: TestClient;
  let ctx: InvariantContext;
  let detachFE: (() => void) | null = null;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    pair = await setupClientPair({ testLabel: 'invariants' });
    writer = pair.a;

    const writerVault = new HarnessVault();
    const writerFE = new FakeFileExplorer();
    detachFE = writerFE.attach(writerVault as unknown as Vault);

    // #341 fix: wire the writer-side reflector so every adapter op
    // mirrors into writerVault.fileMap + the trigger bus. Without
    // this, I1 (fileMap mirror) and I2 (matching trigger) both fail
    // on the very first op — which is exactly the regression the
    // scenario runner is here to catch.
    writer.adapter.setWriterReflector(makeWriterReflector(writerVault));

    ctx = { client: writer, writerVault, writerFE, opsApplied: [] };
  });

  afterAll(async () => {
    try { detachFE?.(); } catch { /* best effort */ }
    if (pair) await pair.cleanup();
  });

  it('basic-crud — every op satisfies I1 + I2 (#341)', async () => {
    const p1 = `inv-${stamp}-a.bin`;
    const p2 = `inv-${stamp}-b.bin`;

    const ops: AdapterOpKind[] = [
      { kind: 'write',  path: p1, content: asArrayBuffer(Buffer.from('hello')) },
      { kind: 'write',  path: p1, content: asArrayBuffer(Buffer.from('world')) }, // modify
      { kind: 'rename', oldPath: p1, newPath: p2 },
      { kind: 'remove', path: p2 },
    ];

    const report = await runScenario({
      scenarioName: 'basic-crud',
      ctx,
      ops,
      invariants: [INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER, INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER],
    });

    expect(report.allOk, formatReport(report)).toBe(true);
  });

  it('rename-chain — sequential renames preserve I1 + I2 (#341)', async () => {
    // Resets between scenarios are intentionally not done — the
    // accumulated state mirrors how Obsidian's vault state would
    // accumulate over a real session.
    const a = `inv-chain-${stamp}-a.bin`;
    const b = `inv-chain-${stamp}-b.bin`;
    const c = `inv-chain-${stamp}-c.bin`;
    const d = `inv-chain-${stamp}-d.bin`;

    const ops: AdapterOpKind[] = [
      { kind: 'write',  path: a, content: asArrayBuffer(Buffer.from('seed')) },
      { kind: 'rename', oldPath: a, newPath: b },
      { kind: 'rename', oldPath: b, newPath: c },
      { kind: 'rename', oldPath: c, newPath: d },
    ];

    const report = await runScenario({
      scenarioName: 'rename-chain',
      ctx,
      ops,
      invariants: [INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER, INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER],
    });

    expect(report.allOk, formatReport(report)).toBe(true);
  });

  it('catalog completeness — every invariant has a name + description', () => {
    // Sanity test: not a regression test for #341/#342, just a guard
    // that catalog entries don't lose their identity over time. Stays
    // green today and forever.
    for (const inv of ALL_INVARIANTS) {
      expect(inv.name, `invariant missing name`).toBeTruthy();
      expect(inv.description, `${inv.name} missing description`).toBeTruthy();
      expect(inv.name.length).toBeGreaterThan(0);
      expect(inv.description.length).toBeGreaterThan(0);
    }
    // I3 is documented in the catalog but covered by Layer 2; verify
    // the catalog still includes it as a tracked invariant.
    expect(ALL_INVARIANTS.map((i) => i.name)).toContain('I3.SHARED_CONFIG_ROUND_TRIPS');
  });
});
