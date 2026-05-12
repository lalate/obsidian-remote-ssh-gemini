import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fc from 'fast-check';
import type { Vault } from 'obsidian';
import { FakeFileExplorer } from '../helpers/FakeFileExplorer';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { HarnessVault, asArrayBuffer } from './helpers/harnessVault';
import {
  runScenario,
  formatReport,
  INV_WRITER_VAULT_FILEMAP_MIRRORS_ADAPTER,
  INV_ADAPTER_OP_FIRES_MATCHING_TRIGGER,
  type InvariantContext,
} from './helpers/invariants';
import { opSequenceArbitrary } from './helpers/propertyTesting';
import { expectFailingWithShape } from './helpers/expectFailingWithShape';

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
  let writerVault: HarnessVault;
  let writerFE: FakeFileExplorer;
  let detachFE: (() => void) | null = null;

  beforeAll(async () => {
    pair = await setupClientPair({ testLabel: 'prop' });
    writer = pair.a;

    writerVault = new HarnessVault();
    writerFE = new FakeFileExplorer();
    detachFE = writerFE.attach(writerVault as unknown as Vault);

    // Seed the live path set on the remote. Use small distinct
    // payloads so a future hash-equality invariant could discriminate.
    for (let i = 0; i < SEED_PATHS.length; i++) {
      await writer.adapter.writeBinary(
        SEED_PATHS[i],
        asArrayBuffer(Buffer.from(`seed-${i}`)),
      );
    }
  });

  afterAll(async () => {
    try { detachFE?.(); } catch { /* best effort */ }
    if (pair) await pair.cleanup();
  });

  it('property — TODAY: I1 + I2 violated for at least some random sequence (#341)', async () => {
    await expectFailingWithShape(
      () => fc.assert(
        fc.asyncProperty(
          opSequenceArbitrary({
            seedPaths: SEED_PATHS,
            freshPaths: FRESH_PATHS,
            minOps: 1,
            maxOps: 3,
          }),
          async (ops) => {
            // Fresh context per fast-check run. The seed paths were
            // pre-created in beforeAll; the SSH-level state persists
            // across runs, but the assertion looks only at the **last
            // op's** effect on writerVault/writerFE, so stale state
            // from prior runs doesn't poison the check.
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
          },
        ),
        {
          numRuns: 5,
          timeout: 60_000,
          verbose: true,
        },
      ),
      // fc.assert wraps the inner throw with "Property failed after N tests..."
      // and includes the inner formatReport message as part of "Got error:".
      // Match the outer wrapper string (specific to fast-check) plus the
      // expectation that the counterexample is non-empty.
      /Property failed after.*Counterexample/s,
      '#341 — random op sequences trigger I1/I2 violations',
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
