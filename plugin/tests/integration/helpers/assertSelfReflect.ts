import { perfTracer, type SpanRecord } from '../../../src/util/PerfTracer';
import type { FakeFileExplorer, VaultEvent } from '../../helpers/FakeFileExplorer';

/**
 * `assertSelfReflect` — writer self-reflection assertion (Layer 1 of
 * the sync-test framework; companion to `assertSyncReflect`).
 *
 * Whereas `assertSyncReflect` checks that a writer-side mutation
 * eventually shows up on a *different* reader client, this helper
 * checks that the **writer's own** vault state surface (the same
 * `vault.trigger(...)` channel that Obsidian's File Explorer +
 * MetadataCache + open editors subscribe to in real life) sees the
 * mutation. That is the surface a title-bar rename relies on so the
 * editor tab can update its bound `TFile` — issue #341 surfaces
 * because no such reflect happens on the writer side today.
 *
 * Call site contract:
 *
 *     await assertSelfReflect({
 *       op: () => writerAdapter.rename(oldPath, newPath),
 *       fakeFE,                              // attached to writerVault
 *       expect: { path: newPath, event: 'rename' },
 *       budgetMs: 500,
 *     });
 *
 * The helper:
 *
 *   1. Subscribes to the perfTracer span stream.
 *   2. Snapshots t0 = performance.now().
 *   3. Runs `opts.op()` — the writer-side mutation.
 *   4. Awaits `opts.fakeFE.awaitReflect(...)` against the same
 *      FakeFileExplorer instance that's attached to the writer's
 *      vault. That's the "self" in self-reflect: writer mutates,
 *      writer observes.
 *   5. Enforces `budgetMs` as an upper bound on the e2e latency
 *      (op→reflect).
 *   6. Returns `{ spans, e2eMs, cid }` so callers can stitch the
 *      assertion's spans to their own perf instrumentation.
 *
 * Why this is a separate helper rather than a flag on
 * `assertSyncReflect`: the signature already takes a `reader: {...}`
 * struct that semantically reads "the *other* client". Wedging
 * "actually it's the writer this time" into the same name harms
 * call-site clarity. Two helpers, one mental model each.
 */

export interface AssertSelfReflectOpts {
  /**
   * Writer-side mutation. Must await all writer-side work before
   * returning — the helper times from before this is called to when
   * the writer's own FakeFileExplorer observes the reflect.
   */
  op: () => Promise<void>;

  /**
   * The FakeFileExplorer attached to the **writer's** vault. The
   * helper does not own the attach lifecycle; the caller arranges
   * `fakeFE.attach(writerVault)` once per suite and detaches in
   * teardown.
   */
  fakeFE: FakeFileExplorer;

  /** What event/path the writer's FE must observe. */
  expect: { path: string; event: VaultEvent };

  /** Maximum end-to-end latency in milliseconds (op + reflect, t0 → atMs). */
  budgetMs: number;

  /** Optional correlation id; passthrough for the caller's perf spans + result. */
  cid?: string;

  /** Optional label included in error messages so failures point to the case. */
  label?: string;
}

export interface AssertSelfReflectResult {
  /** Every span fired between t0 and reflect (caller filters as needed). */
  spans: SpanRecord[];
  /** End-to-end latency in milliseconds: reflect.atMs − t0. */
  e2eMs: number;
  /** Echoed back from `opts.cid`, undefined when the caller didn't supply one. */
  cid?: string;
}

export async function assertSelfReflect(opts: AssertSelfReflectOpts): Promise<AssertSelfReflectResult> {
  const captured: SpanRecord[] = [];
  const off = perfTracer.onSpan((s) => captured.push(s));

  const t0 = performance.now();
  try {
    try {
      await opts.op();
    } catch (e) {
      throw new Error(
        `${labelPrefix(opts.label)}op() threw before reflect: ${(e as Error).message}`,
      );
    }

    let reflectAtMs: number;
    try {
      const r = await opts.fakeFE.awaitReflect(opts.expect.path, opts.expect.event, opts.budgetMs);
      reflectAtMs = r.atMs;
    } catch (e) {
      throw new Error(
        `${labelPrefix(opts.label)}awaitReflect failed: ${(e as Error).message}`,
      );
    }

    const e2eMs = reflectAtMs - t0;
    if (e2eMs > opts.budgetMs) {
      throw new Error(
        `${labelPrefix(opts.label)}e2eMs ${e2eMs.toFixed(1)} exceeded budget ${opts.budgetMs}ms ` +
        `(op→${opts.expect.event}@"${opts.expect.path}")`,
      );
    }

    return { spans: captured, e2eMs, cid: opts.cid };
  } finally {
    off();
  }
}

function labelPrefix(label: string | undefined): string {
  return label ? `[${label}] ` : '';
}
