import * as fc from 'fast-check';
import type { AdapterOpKind } from './invariants';

/**
 * Property-based generators for Layer 3.
 *
 * The scenario runner in `invariants.ts` is deterministic — caller
 * picks the op sequence. This file adds a fast-check arbitrary that
 * generates **valid** random op sequences against a small seeded
 * path set, so the invariant catalog gets exercised across the
 * combinatorial space of (rename / write / remove) interactions
 * the scenario suite covers manually.
 *
 * Validity matters because adapter ops are not commutative or
 * commutative-free: `rename(a→b)` then `rename(a→c)` would crash on
 * the second call because `a` no longer exists. The generator tracks
 * an in-memory `Set<string>` model of existing paths and only emits
 * ops the model says are valid.
 *
 * When an invariant violation surfaces, fast-check's automatic
 * shrinking simplifies the failing sequence to the smallest
 * reproducer that still violates the invariant — usually a single
 * op against a single path. That diagnostic is exactly what the
 * `formatReport` output in `invariants.ts` is shaped to display.
 */

export interface OpSequenceArbitraryOpts {
  /**
   * Paths that already exist on disk before the sequence runs. The
   * test fixture is responsible for pre-creating these via the
   * adapter; the generator just trusts them as live.
   */
  seedPaths: string[];

  /**
   * Pool of fresh path names the generator can use as rename targets
   * (or new writes). Must be disjoint from `seedPaths`. The generator
   * picks uniformly from this pool when it needs a new path.
   */
  freshPaths: string[];

  /** Max ops per sequence. Default 5; small so shrinking stays fast. */
  maxOps?: number;

  /** Min ops per sequence. Default 1. */
  minOps?: number;
}

/**
 * Build an `Arbitrary<AdapterOpKind[]>` that produces sequences
 * the adapter can actually execute without crashing — every rename
 * targets a path the model believes exists, every remove similarly.
 *
 * Implementation note: we generate via repeated coin flips inside a
 * `fc.gen()` callback rather than using `fc.commands` because the
 * latter introduces a separate model class hierarchy that's heavier
 * than this single-purpose generator needs. The callback closure
 * threads the model `Set` mutably; fast-check's shrinker doesn't
 * mind, because each shrink re-runs the callback from scratch.
 */
export function opSequenceArbitrary(
  opts: OpSequenceArbitraryOpts,
): fc.Arbitrary<AdapterOpKind[]> {
  const minOps = opts.minOps ?? 1;
  const maxOps = opts.maxOps ?? 5;

  // Build the union choice once so the inner gen() function stays
  // fast. `weight` favours rename + modify over remove so we get
  // longer-lived sequences (a remove-heavy sequence converges to an
  // empty set quickly, leaving the generator with nothing to do).
  const opKindArb = fc.oneof(
    { weight: 4, arbitrary: fc.constant('rename' as const) },
    { weight: 4, arbitrary: fc.constant('modify' as const) },
    { weight: 1, arbitrary: fc.constant('remove' as const) },
  );

  const contentArb = fc.uint8Array({ minLength: 1, maxLength: 32 });

  return fc.gen().map((g) => {
    const live = new Set<string>(opts.seedPaths);
    const freshPool = [...opts.freshPaths];
    // Shuffle the fresh pool deterministically per-run via fc so
    // shrinking can collapse "pick fresh[2] then fresh[3]" to
    // "pick fresh[0]" — keeps the failure diagnostic minimal.
    // The `g` callback in fast-check 4.x's fc.gen() takes
    // (builderFactory, ...args), not a pre-built Arbitrary.
    const shuffledFresh = g(fc.shuffledSubarray, freshPool, { minLength: freshPool.length, maxLength: freshPool.length });

    let freshIdx = 0;
    const takeFresh = (): string | null => {
      while (freshIdx < shuffledFresh.length) {
        const p = shuffledFresh[freshIdx++];
        if (!live.has(p)) return p;
      }
      return null;
    };

    const length = g(fc.integer, { min: minOps, max: maxOps });
    const ops: AdapterOpKind[] = [];

    for (let i = 0; i < length; i++) {
      if (live.size === 0) {
        // No live paths → only writes are possible. Emit one and
        // continue.
        const path = takeFresh();
        if (!path) break;
        live.add(path);
        ops.push({ kind: 'write', path, content: toArrayBuffer(g(() => contentArb)) });
        continue;
      }

      const kind = g(() => opKindArb);
      const liveArr = [...live];
      const pickLive = (): string => liveArr[g(fc.integer, { min: 0, max: liveArr.length - 1 })];

      switch (kind) {
        case 'modify': {
          // adapter.writeBinary on an existing path is a modify.
          const path = pickLive();
          ops.push({ kind: 'write', path, content: toArrayBuffer(g(() => contentArb)) });
          continue;
        }
        case 'remove': {
          const path = pickLive();
          live.delete(path);
          ops.push({ kind: 'remove', path });
          continue;
        }
        case 'rename': {
          const oldPath = pickLive();
          const newPath = takeFresh();
          if (!newPath) {
            // Fresh pool exhausted; fall back to a modify so the
            // sequence stays valid.
            ops.push({ kind: 'write', path: oldPath, content: toArrayBuffer(g(() => contentArb)) });
            continue;
          }
          live.delete(oldPath);
          live.add(newPath);
          ops.push({ kind: 'rename', oldPath, newPath });
          continue;
        }
      }
    }

    return ops;
  });
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
