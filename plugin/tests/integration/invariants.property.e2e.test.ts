import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fc from 'fast-check';
import type { Vault } from 'obsidian';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { HarnessVault, asArrayBuffer, makeWriterReflector } from './helpers/harnessVault';
import {
  runScenario,
  formatReport,
  INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER,
  INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER,
  type InvariantContext,
} from './helpers/invariants';
import { opSequenceArbitrary } from './helpers/propertyTesting';

/**
 * Layer 3 (extended) — **property-based** invariant suite.
 *
 * Companion to `invariants.e2e.test.ts`. That file lists hand-picked
 * scenarios (basic-crud, rename-chain). This one generates random
 * sequences of valid ops via fast-check and checks the same
 * invariants after every step.
 *
 * The win is **automatic shrinking**: when an invariant fails, fast-
 * check reduces the failing sequence to the smallest reproducer that
 * still violates the invariant — usually a single op against a
 * single path. That output, combined with `formatReport`, names both
 * the violated invariant and the exact op that triggered it.
 *
 * Today this `it.fails(...)` because both I1 and I2 are violated on
 * the very first op. The fix PRs that drop `.fails` markers from
 * `invariants.e2e.test.ts` also drop this one.
 *
 * Numbers tuned for SSH-network cost:
 *
 *   - `numRuns: 5`            — each run is a short SSH session,
 *                               so we keep the count low.
 *   - `maxOps: 3` per seq     — minimal sequences that still
 *                               exercise the asymmetry; shrinking
 *                               converges fast.
 *   - `timeout: 60_000`       — generous per the property; the SSH
 *                               connection cost dominates.
 *
 * The integration CI workflow runs this against the docker test
 * sshd. Local devs run it via `npm run test:integration`.
 */

if (!fs.existsSync(TEST_PRIVATE_KEY)) {
  throw new Error(
    `Integration test keypair missing at ${TEST_PRIVATE_KEY}. ` +
    'Run `npm run sshd:start` from the repo root before `npm run test:integration`.',
  );
}

const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SEED_PATHS = [
  `prop-${STAMP}-seed-0.bin`,
  `prop-${STAMP}-seed-1.bin`,
  `prop-${STAMP}-seed-2.bin`,
];
const FRESH_PATHS = [
  `prop-${STAMP}-fresh-0.bin`,
  `prop-${STAMP}-fresh-1.bin`,
  `prop-${STAMP}-fresh-2.bin`,
  `prop-${STAMP}-fresh-3.bin`,
  `prop-${STAMP}-fresh-4.bin`,
];

describe('Layer 3 — property-based invariants', () => {
  let pair: Awaited<ReturnType<typeof setupClientPair>>;
  let writer: TestClient;

  beforeAll(async () => {
    pair = await setupClientPair({ testLabel: 'prop' });
    writer = pair.a;
  });

  afterAll(async () => {
    if (pair) await pair.cleanup();
  });

  it('every short op sequence satisfies I1 + I2 (#341)', async () => {
    await fc.assert(
      fc.asyncProperty(
        opSequenceArbitrary({
          seedPaths: SEED_PATHS,
          freshPaths: FRESH_PATHS,
          minOps: 1,
          maxOps: 3,
        }),
        async (ops) => {
          // Hermetic per fast-check run. fast-check reuses one process
          // across `numRuns` + shrink reruns, but the generator resets
          // its liveness model to SEED_PATHS every invocation — so if
          // run K renamed/removed a seed path, run K+1 would emit an
          // op against a path that no longer exists on the remote OR
          // in a shared vault, spuriously failing I1/I2. Each run
          // therefore gets a fresh vault + FE + reflector AND re-seeds
          // SEED_PATHS on the remote, so the generator's model, the
          // remote, and the asserted vault all agree at op 0.
          const writerVault = new HarnessVault();
          const writerFE = new FakeFileExplorer();
          const detach = writerFE.attach(writerVault as unknown as Vault);
          writer.adapter.setWriterReflector(makeWriterReflector(writerVault));
          try {
            for (let i = 0; i < SEED_PATHS.length; i++) {
              await writer.adapter.writeBinary(
                SEED_PATHS[i],
                asArrayBuffer(Buffer.from(`seed-${i}`)),
              );
            }

            const ctx: InvariantContext = {
              client: writer,
              writerVault,
              writerFE,
              opsApplied: [],
            };

            const report = await runScenario({
              scenarioName: 'property-driven',
              ctx,
              ops,
              invariants: [
                INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER,
                INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER,
              ],
              settleMs: 50, // tight; the property runs a lot
            });

            if (!report.allOk) {
              // Throwing from inside fc.asyncProperty triggers
              // shrinking; the error message reaches the eventual
              // `it` assertion with the shrunk sequence inlined.
              throw new Error(formatReport(report));
            }
          } finally {
            try { detach(); } catch { /* best effort */ }
            writer.adapter.setWriterReflector(null);
          }
        },
      ),
      {
        numRuns: 5,
        timeout: 60_000,
        verbose: true,
      },
    );
  });

  it('arbitrary self-test — generator only emits sequences valid against the model', () => {
    // Sanity test: the property generator must not produce invalid
    // sequences (e.g. rename of a path that was never created). The
    // adapter would crash, masquerading as an invariant failure.
    //
    // We sample 50 sequences and check basic validity rules: every
    // rename's `oldPath` was either seeded or created/renamed-into
    // by an earlier op; every remove similarly.
    const samples: Array<readonly unknown[]> = [];
    const sampleArb = opSequenceArbitrary({
      seedPaths: SEED_PATHS,
      freshPaths: FRESH_PATHS,
      minOps: 1,
      maxOps: 5,
    });
    for (let i = 0; i < 50; i++) {
      const seq = fc.sample(sampleArb, 1)[0];
      samples.push(seq);
      const live = new Set<string>(SEED_PATHS);
      for (const op of seq) {
        switch (op.kind) {
          case 'write':
            live.add(op.path);
            break;
          case 'rename':
            expect(live.has(op.oldPath), `invalid rename: oldPath '${op.oldPath}' not live`).toBe(true);
            live.delete(op.oldPath);
            live.add(op.newPath);
            break;
          case 'remove':
            expect(live.has(op.path), `invalid remove: path '${op.path}' not live`).toBe(true);
            live.delete(op.path);
            break;
          case 'mkdir':
            live.add(op.path);
            break;
        }
      }
    }
    // Coverage smoke: at least one of the 50 samples should contain
    // a rename (otherwise the arbitrary is broken and we're only
    // exercising writes).
    expect(samples.some((s) => s.some((op: unknown) => (op as { kind: string }).kind === 'rename')))
      .toBe(true);
  });
});
