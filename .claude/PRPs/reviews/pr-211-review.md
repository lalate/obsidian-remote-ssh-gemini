# PR Review: #211 — test: TDD堅牢化 — カバレッジ閾値・共通モックファクトリ・エッジケーステスト

**Reviewed**: 2026-05-02
**Author**: sotashimozono
**Branch**: feat/tdd-coverage-improvements → main
**Decision**: APPROVE (with MEDIUM comments)

## Summary
Solid TDD improvement PR: shared mock factories are well-factored, the new edge-case tests for FramedDuplex and ReconnectManager cover real failure modes, and the integration test helpers are clean and dependency-free. Two medium issues worth addressing: an unsafe type cast in test code that can silently break under future refactors, and non-deterministic timestamps in makeStatResult.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

1. **`plugin/tests/ReconnectManager.test.ts:186` — unsafe type cast bypasses discriminated union narrowing**
   The `onState` callback casts `s` to `{ kind: 'waiting'; delayMs: number }` without narrowing first. If `ReconnectState`'s `waiting` variant changes shape, TypeScript won't catch the broken assertion here. Use a conditional guard instead:
   ```ts
   // Before (unsafe cast):
   if (s.kind === 'waiting') delays.push((s as { kind: 'waiting'; delayMs: number }).delayMs);
   // After (narrowed):
   if (s.kind === 'waiting') delays.push(s.delayMs);
   ```

2. **`plugin/tests/helpers/fs-mock.ts:52-53` — non-deterministic default timestamps**
   `makeStatResult` defaults `mtimeMs` and `ctimeMs` to `Date.now()`. Tests that compare timestamps without overriding these will be time-sensitive and can flake. Prefer a stable default (e.g. `1_000_000_000_000`).

### LOW

1. **`plugin/tests/integration/helpers/sshd-config.ts:27` — `hostVerifier: () => true` should have a comment**
   Silently bypassing host-key verification is correct for a controlled test container, but a brief comment (`// Test container: accept any host key`) helps reviewers understand this is intentional, not an oversight.

2. **`plugin/vitest.config.ts` — thresholds are very tight to actual coverage**
   Current thresholds (78/70/72) are within 1-2% of actual measured coverage (78.52/71.99/72.77). A single uncovered branch in a new helper file could fail CI. Consider a 2-3 point buffer (76/68/70) to reduce churn from unrelated changes.

## Validation Results

| Check | Result |
|---|---|
| Type check | Skipped (node_modules permission issue on Dropbox) |
| Lint | Skipped (node_modules permission issue on Dropbox) |
| Tests | Skipped (local env) — CI is the source of truth |
| Build | Skipped |

## Files Reviewed
- `plugin/tests/helpers/ssh-mock.ts` — Added
- `plugin/tests/helpers/fs-mock.ts` — Added
- `plugin/tests/integration/helpers/sshd-config.ts` — Added
- `plugin/tests/framing.test.ts` — Modified (3 new test cases)
- `plugin/tests/ReconnectManager.test.ts` — Modified (4 new test cases)
- `plugin/vitest.config.ts` — Modified (coverage thresholds added)
- `manifest.json`, `plugin/manifest.json`, `versions.json`, `plugin/versions.json`, `plugin/package.json`, `plugin/package-lock.json` — Modified (version bump 0.4.109→0.4.110)
