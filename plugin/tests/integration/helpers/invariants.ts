import type { FakeFileExplorer } from '../../helpers/FakeFileExplorer';
import type { HarnessVault } from './harnessVault';
import type { TestClient } from './makeAdapter';

/**
 * Layer 3 of the sync-test framework — **invariant catalog + scenario
 * runner**.
 *
 * The Layer 1/2 helpers each test one concrete contract violation
 * (self-reflect, restart-roundtrip). Layer 3 raises the abstraction:
 * declare invariants the system should *always* satisfy, and have a
 * scenario runner that applies a sequence of operations + checks
 * every invariant after every step.
 *
 * This file ships the **scenario-driven** runner. The fast-check
 * property-based wrapper (apply random ops, shrink failures to a
 * minimal reproducer) is a follow-up RFC — the Invariant interface
 * is designed to be stable across both runners, so plugging
 * `fast-check` in later is purely additive.
 *
 * Three invariants today:
 *
 *   I1. WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER
 *       After every adapter mutation, the writer's `vault.fileMap`
 *       contains the new path's TFile and the old path's TFile is
 *       gone (for renames + deletes). Captures #341.
 *
 *   I2. ADAPTER_OP_FIRES_MATCHING_TRIGGER
 *       Every adapter mutation observed by an attached FakeFileExplorer
 *       within `BUDGET_MS`. Captures #341 from the event-stream side.
 *
 *   I3. SHARED_CONFIG_ROUND_TRIPS
 *       For every file in the shared-config allowlist, a write through
 *       any session's adapter is visible to the next session's
 *       Obsidian-side reader. Captures #342.
 *
 * Each invariant is a pure function over a `SyncState` snapshot —
 * easy to compose into ad-hoc scenarios and easy to shrink later.
 */

export type AdapterOpKind =
  | { kind: 'write'; path: string; content: ArrayBuffer }
  | { kind: 'rename'; oldPath: string; newPath: string }
  | { kind: 'remove'; path: string }
  | { kind: 'mkdir'; path: string };

export interface InvariantContext {
  /** The writer's adapter we're driving. */
  client: TestClient;
  /** The writer's in-memory vault (what Obsidian's File Explorer would see). */
  writerVault: HarnessVault;
  /** Attached to `writerVault` so events flow into a queryable snapshot. */
  writerFE: FakeFileExplorer;
  /** Ops applied so far in this scenario, in order. */
  opsApplied: AdapterOpKind[];
}

export interface InvariantResult {
  /** True if the invariant holds in the current state. */
  ok: boolean;
  /** Human-readable diagnostic when `ok` is false. */
  reason?: string;
}

export interface Invariant {
  name: string;
  /** Short description for failure messages and catalog listings. */
  description: string;
  /** Pure check against the post-op state snapshot. */
  check(ctx: InvariantContext): InvariantResult;
}

// ─────────────────────────────────────────────────────────────────────
// Invariant catalog
// ─────────────────────────────────────────────────────────────────────

/**
 * I1 — every mutation lands in `vault.fileMap` for the writer.
 *
 * After every op:
 *   - `write` / `mkdir`: target path appears in fileMap
 *   - `rename`:          newPath appears, oldPath disappears
 *   - `remove`:          path disappears
 *
 * Today this fails because `SftpDataAdapter` doesn't synchronously
 * update the writer's vault model on local-originated mutations. The
 * remote SSH succeeds but the in-memory map drifts.
 */
export const INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER: Invariant = {
  name: 'I1.WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER',
  description: 'writer.vault.fileMap reflects every adapter mutation by the writer',
  check(ctx) {
    if (ctx.opsApplied.length === 0) return { ok: true };
    const last = ctx.opsApplied[ctx.opsApplied.length - 1];
    switch (last.kind) {
      case 'write':
      case 'mkdir': {
        const present = ctx.writerVault.getAbstractFileByPath(last.path) !== null;
        return present
          ? { ok: true }
          : { ok: false, reason: `expected '${last.path}' in fileMap after ${last.kind}` };
      }
      case 'rename': {
        const newPresent = ctx.writerVault.getAbstractFileByPath(last.newPath) !== null;
        const oldGone   = ctx.writerVault.getAbstractFileByPath(last.oldPath) === null;
        if (!newPresent) return { ok: false, reason: `expected '${last.newPath}' in fileMap after rename` };
        if (!oldGone)    return { ok: false, reason: `expected '${last.oldPath}' gone from fileMap after rename` };
        return { ok: true };
      }
      case 'remove': {
        const gone = ctx.writerVault.getAbstractFileByPath(last.path) === null;
        return gone
          ? { ok: true }
          : { ok: false, reason: `expected '${last.path}' gone from fileMap after remove` };
      }
    }
  },
};

/**
 * I2 — every adapter mutation produces a matching `vault.trigger(...)`.
 *
 * Checks the FakeFileExplorer snapshot for the new path; if absent,
 * the writer's event bus didn't fire. `FakeFileExplorer.snapshot()`
 * is populated only via `vault.on(...)` callbacks, so a missing entry
 * is equivalent to a missing trigger.
 *
 * Today this fails for the same reason as I1: the adapter writes
 * pass through SSH but the trigger bus isn't notified locally.
 */
export const INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER: Invariant = {
  name: 'I2.ADAPTER_OP_FIRES_MATCHING_TRIGGER',
  description: 'each adapter mutation fires a matching vault.trigger on the writer',
  check(ctx) {
    if (ctx.opsApplied.length === 0) return { ok: true };
    const last = ctx.opsApplied[ctx.opsApplied.length - 1];
    const snap = ctx.writerFE.snapshot();
    const has = (p: string) => snap.paths.includes(p);

    switch (last.kind) {
      case 'write':
      case 'mkdir':
        return has(last.path)
          ? { ok: true }
          : { ok: false, reason: `FakeFileExplorer never saw '${last.path}' (no trigger fired)` };
      case 'rename':
        if (!has(last.newPath)) {
          return { ok: false, reason: `FakeFileExplorer never saw '${last.newPath}' after rename (no trigger)` };
        }
        if (has(last.oldPath)) {
          return { ok: false, reason: `FakeFileExplorer still sees '${last.oldPath}' after rename` };
        }
        return { ok: true };
      case 'remove':
        return has(last.path)
          ? { ok: false, reason: `FakeFileExplorer still sees '${last.path}' after remove` }
          : { ok: true };
    }
  },
};

/**
 * I3 — shared Obsidian config files round-trip across plugin restart.
 *
 * Not checked by this scenario runner directly (it requires a
 * `ShadowVaultBootstrap` restart cycle). Tracked here in the catalog
 * for completeness; the Layer 2 suite (`restart-roundtrip.e2e.test.ts`)
 * exercises it as a standalone case.
 *
 * Today this fails — see Layer 2 cases.
 */
export const INV_SHARED_CONFIG_ROUND_TRIPS: Invariant = {
  name: 'I3.SHARED_CONFIG_ROUND_TRIPS',
  description: 'shared .obsidian/* config files survive plugin restart (covered by Layer 2)',
  check(): InvariantResult {
    return { ok: true }; // not run by the scenario runner; see Layer 2
  },
};

export const ALL_INVARIANTS: readonly Invariant[] = [
  INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER,
  INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER,
  INV_SHARED_CONFIG_ROUND_TRIPS,
];

// ─────────────────────────────────────────────────────────────────────
// Scenario runner
// ─────────────────────────────────────────────────────────────────────

export interface ScenarioReport {
  scenarioName: string;
  opsApplied: AdapterOpKind[];
  /** Per-op-step invariant results, in order. */
  perStep: Array<{
    op: AdapterOpKind;
    results: Array<{ invariant: string; result: InvariantResult }>;
  }>;
  /** True iff every invariant held after every op. */
  allOk: boolean;
}

/**
 * Apply a sequence of ops to the writer's adapter, checking every
 * invariant after each op. Returns a `ScenarioReport` that the test
 * case can inspect / format for failure messages.
 *
 * Ops that crash on the adapter (e.g. rename of a path that was never
 * created) abort the scenario at that point and surface the throw —
 * those are bugs in the scenario definition, not the system under
 * test.
 */
export async function runScenario(opts: {
  scenarioName: string;
  ctx: InvariantContext;
  ops: AdapterOpKind[];
  /** Wait for the FakeFileExplorer to settle between ops (ms). Default 100. */
  settleMs?: number;
  /** Defaults to `ALL_INVARIANTS`. Pass a subset to focus the assertion. */
  invariants?: readonly Invariant[];
}): Promise<ScenarioReport> {
  const invariants = opts.invariants ?? ALL_INVARIANTS;
  const settleMs = opts.settleMs ?? 100;
  const report: ScenarioReport = {
    scenarioName: opts.scenarioName,
    opsApplied: [],
    perStep: [],
    allOk: true,
  };

  for (const op of opts.ops) {
    await applyOp(opts.ctx.client, op);
    opts.ctx.opsApplied.push(op);
    report.opsApplied.push(op);

    if (settleMs > 0) await new Promise<void>((r) => setTimeout(r, settleMs));

    const stepResults: Array<{ invariant: string; result: InvariantResult }> = [];
    for (const inv of invariants) {
      const r = inv.check(opts.ctx);
      stepResults.push({ invariant: inv.name, result: r });
      if (!r.ok) report.allOk = false;
    }
    report.perStep.push({ op, results: stepResults });
  }

  return report;
}

async function applyOp(client: TestClient, op: AdapterOpKind): Promise<void> {
  switch (op.kind) {
    case 'write':
      await client.adapter.writeBinary(op.path, op.content);
      return;
    case 'rename':
      await client.adapter.rename(op.oldPath, op.newPath);
      return;
    case 'remove':
      await client.adapter.remove(op.path);
      return;
    case 'mkdir':
      await client.adapter.mkdir(op.path);
      return;
  }
}

/** Pretty-print a ScenarioReport for assertion error messages. */
export function formatReport(report: ScenarioReport): string {
  const lines: string[] = [
    `Scenario "${report.scenarioName}" — ${report.allOk ? 'OK' : 'FAILED'}`,
    `Applied ${report.opsApplied.length} ops`,
  ];
  for (let i = 0; i < report.perStep.length; i++) {
    const step = report.perStep[i];
    const failed = step.results.filter((r) => !r.result.ok);
    if (failed.length === 0) continue;
    lines.push(`  step ${i + 1} (${step.op.kind}): ${failed.length} invariant(s) failed`);
    for (const f of failed) {
      lines.push(`    - ${f.invariant}: ${f.result.reason ?? '(no reason)'}`);
    }
  }
  return lines.join('\n');
}
