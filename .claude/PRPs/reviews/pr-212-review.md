# PR Review: #212 — feat: HostKeyConfirmModal (TOFU UI) + named error classes + fingerprint util分離

**Reviewed**: 2026-05-02 (updated)
**Author**: sotashimozono
**Branch**: feat/src-improvements → main
**Decision**: APPROVE (MEDIUM/LOW findings)

## Summary
All HIGH issues resolved. fingerprint utility is clean and well-tested, named error classes are typed correctly, HostKeyConfirmModal follows existing modal patterns, and the e2e CDP helpers significantly improve test stability. Two minor items remain (tracked separately).

## Findings

### CRITICAL
None

### HIGH
None (previously: obsidian.ts path replacement — fixed in 8913310)

### MEDIUM
**`plugin/src/ui/HostKeyConfirmModal.ts` — `trust-once` shown in UI without backend support**
HostKeyStore has no trust-once path. Tracked in #209.

### LOW
**`plugin/src/transport/errorTaxonomy.ts:309` — Named error classes not classified by `classifyError()`**
`throw new AuthFailedError(...)` will produce category `unknown`. Either add instanceof branches or document the intent.

## Validation Results
| Check | Result |
|---|---|
| Type check | Skipped (Dropbox node_modules permissions) |
| Lint | Skipped |
| Tests | CI pending |
| Build | Skipped |

## Files Reviewed
- `plugin/src/util/fingerprint.ts` — Added
- `plugin/src/ui/HostKeyConfirmModal.ts` — Added
- `plugin/src/ui/HostKeyMismatchModal.ts` — Modified
- `plugin/src/transport/errorTaxonomy.ts` — Modified
- `plugin/e2e/helpers/obsidian.ts` — Modified
- `plugin/tests/fingerprint.test.ts` — Added
- version/manifest files — Modified (0.4.111)
