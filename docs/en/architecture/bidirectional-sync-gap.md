---
title: Bidirectional sync gap — design analysis (issues #341 & #342)
description: How the shadow-vault adapter's one-way write-through surfaces as two separate user-facing bugs, and the test framework that captures the asymmetry.
---

# Bidirectional sync gap — design analysis

> **Status**: open design issue, captured by the Layer 1/2/3 sync-test framework in `plugin/tests/integration/`.
> **Affected version**: 1.0.48.
> **Bug reports**: [#341](https://github.com/sotashimozono/obsidian-remote-ssh/issues/341), [#342](https://github.com/sotashimozono/obsidian-remote-ssh/issues/342).

## TL;DR

Two bugs reported against 1.0.48 share the same architectural root cause: **the shadow-vault adapter patch is a one-way write-through that bypasses Obsidian's own vault-state synchronization and config-load lifecycle.** They are not isolated bugs — they are two visible failure modes of the same gap in the design.

- **#341 (rename not reflected in editor)**: `SftpDataAdapter.rename()` sends the rename over SSH but never fires `vault.trigger('rename', file, oldPath)`. The editor's `TFile` stays bound to the old path. The remote→local recovery path (`FsChangeListener`) only runs on RPC transport with daemon `fs.watch`; on plain SFTP it never fires, making the bug permanent there.
- **#342 (settings not persisted)**: `.obsidian/app.json` is not in the shadow-vault bootstrap whitelist nor in any startup pull path. Obsidian writes settings to local disk on the shadow vault and (probably) to remote via the patched adapter, but on next start Obsidian reads the local disk before any sync happens, so the remote state is invisible.

A narrow per-bug fix is feasible, but the **correct long-term design** is a small abstraction layer that defines how each Obsidian state transition — adapter ops, vault events, settings I/O — is bidirectionally reconciled with remote.

## Bug #341: rename not reflected in editor

### Symptom
User renames a file from the editor tab title bar → `.md` file is renamed on remote → editor stays bound to the old `TFile` → next save throws "File not found".

### Code path

1. Title-bar rename → `app.fileManager.renameFile(file, newPath)` → `vault.adapter.rename(oldPath, newPath)`.
2. The adapter is monkey-patched, so `SftpDataAdapter.rename()` runs (`plugin/src/adapter/SftpDataAdapter.ts:492-513`).
3. Adapter behaviour:
   - Translates path via `PathMapper.toRemote`.
   - Calls `client.mkdirp(parentDir)` + `client.rename(oldRemote, newRemote)`.
   - Invalidates cache entries.
   - **Returns without notifying Obsidian's vault model.**
4. Obsidian's `Vault.rename()` is supposed to update `vault.fileMap` after the adapter call. The bug existing in practice suggests Obsidian's wrapper recognises its own adapter and assumes a monkey-patched one might do its own thing.
5. For daemon-RPC transport, `FsChangeListener` (`plugin/src/vault/FsChangeListener.ts:201-259`) eventually receives an `fs.changed renamed` push and calls `VaultModelBuilder.renameOne()` which DOES fire `vault.trigger('rename', ...)`. But:
   - It is asynchronous w.r.t. the user's keystroke, leaving a race window.
   - It does not exist for SFTP-only transport — so on SFTP this bug is **permanent**, never auto-heals.

### Why this is a design gap, not a typo

A complete monkey-patched adapter must replicate every state contract Obsidian's built-in adapter satisfies:

| Op | Remote effect | Local vault state | Editor binding |
|----|---------------|-------------------|----------------|
| `write` | pushed | via `vault.trigger('modify')` from FsChangeListener (RPC only) | OK |
| `create` | pushed | via FsChangeListener (RPC only) | OK |
| `delete` | pushed | via FsChangeListener (RPC only) | OK |
| **`rename`** | pushed | via FsChangeListener (RPC only) | **Race** |
| **adapter bypass** (Obsidian's settings, plugins using `fs` directly) | silently dropped | n/a | n/a |

The "RPC-only" column is the architectural smell. The plugin is fundamentally a network filesystem and the current design relies on a daemon-side `fs.watch` to reconcile local state. When that path is unavailable (SFTP transport, daemon unreachable, watch dropped during reconnect), the local state diverges silently.

## Bug #342: settings not persisted across sessions

### Symptom
User toggles `Settings > Files and links > use [[Wikilinks]]` → `.obsidian/app.json` written → on Obsidian restart, setting is gone.

### Code path

Two possible scenarios:

**Scenario A: Obsidian writes via the patched adapter.**
- `SftpDataAdapter.write('.obsidian/app.json', ...)` runs.
- `PathMapper.isPrivate('.obsidian/app.json')` returns **false** (`app.json` is **not** in `DEFAULT_PRIVATE_PATTERN_BASENAMES` — it's intentionally shared across machines, see `plugin/src/path/PathMapper.ts:29-38`).
- The write goes to remote. **Remote is up to date.**
- BUT the local shadow-vault disk copy of `app.json` is **not updated** — the patched adapter only writes through to remote, it does not maintain a local mirror.
- On restart, Obsidian opens the shadow vault → reads `app.json` from **local disk** → sees the **stale** version.

**Scenario B: Obsidian writes `app.json` via direct `Node fs.writeFile` (bypassing the adapter).**
- Architecture spec §6.5 acknowledges this for plugins that hit `fs` directly. The same hole could apply to Obsidian's own settings save.
- Local disk is updated, remote is not.
- On restart, Obsidian reads local disk → settings appear to persist locally but never round-trip to remote.

Either way, the **missing piece is symmetrical to #341**: there is no path that brings remote state back into Obsidian's view. Search results:

- `grep -r "app.json"` in `plugin/src/` → only a comment (`plugin/src/shadow/ShadowVaultBootstrap.ts:52`).
- `ShadowVaultBootstrap` (`plugin/src/shadow/ShadowVaultBootstrap.ts:74-137`) initialises `community-plugins.json` and `data.json` but explicitly avoids touching files Obsidian creates ("Obsidian fills the rest on first open").
- `ShadowStartupCoordinator.prepareForAutoConnect()` (`plugin/src/shadow/ShadowStartupCoordinator.ts:52-55`) installs community plugins, no `.obsidian/app.json` handling.
- `main.ts onLayoutReady` → `runShadowStartup()` → `connectProfile()` → no remote pull of Obsidian-owned config.

The design intent was: "Obsidian creates its config files on first open and we leave them alone." But the implication — **subsequent edits to those files do not round-trip** — was apparently not anticipated.

## Common root cause: missing bidirectionality

Both bugs are emergent from the same gap. The current shadow-vault design has **three** I/O surfaces:

1. **Adapter writes (local → remote)** — patched, works.
2. **Adapter reads (remote → local on demand)** — works via `ReadCache`/`DirCache`.
3. **Vault state synchronization** — partial, depends on RPC `fs.watch`.

What's missing — and what would fix both bugs — is an explicit **"local state ↔ Obsidian model"** layer that:

- Receives every local-originated mutation (rename / write / delete / config change).
- Pushes the mutation to remote.
- Updates Obsidian's in-memory model (`vault.fileMap`) and fires the appropriate `vault.trigger`.
- Listens for remote-originated change pushes and applies them symmetrically.
- Maintains a deduplication ledger so local→remote→local echoes don't double-apply.

This is precisely the `RemoteFs` interface direction recorded as the v1.1 target. #341 and #342 are concrete proof that the abstraction needs to exist before more transports are added.

## How the test framework captures this

The Layer 1/2/3 sync-test framework in `plugin/tests/integration/` exists to make the asymmetry observable and unmissable. Every regression test is `it.fails(...)` today — the suite documents what the contract *should* be, and the helper times out / throws because no reflect arrives. When the production fix lands and removes `.fails`, vitest treats the now-passing tests as the regression-prevention guard.

| Layer | File | What it asserts |
|-------|------|-----------------|
| 1 (SFTP) | `self-reflect.e2e.test.ts` | After `adapter.{write,rename,remove}`, the writer's vault observes the matching `vault.trigger(...)` within budget. Five `it.fails(...)` cases. |
| 1 (RPC) | `self-reflect-rpc.e2e.test.ts` | Same contract over daemon-RPC transport — proves the gap isn't SFTP-specific. Four `it.fails(...)` cases. |
| 2 | `restart-roundtrip.e2e.test.ts` | After remote `.obsidian/<file>` is seeded, `ShadowVaultBootstrap` pulls it into the local shadow disk. Four `it.fails(...)` cases (`app.json`, `appearance.json`, `core-plugins.json`, `hotkeys.json`). |
| 3 (scenario) | `invariants.e2e.test.ts` | Hand-picked op sequences (basic-crud, rename-chain) satisfy `I1` (fileMap mirror) + `I2` (matching trigger). |
| 3 (property) | `invariants.property.e2e.test.ts` | Random valid op sequences via fast-check; failures shrink to a minimal reproducer naming the violated invariant and exact op. |

## Top files to read for the fix

1. **`plugin/src/adapter/SftpDataAdapter.ts`** (L492 `rename()`, L390 `write()`, L460 `remove()`) — needs vault-state notification.
2. **`plugin/src/shadow/ShadowVaultBootstrap.ts`** (L74 `bootstrapSync`) — needs `seedObsidianConfig()` step for #342.
3. **`plugin/src/path/PathMapper.ts`** (L29 `DEFAULT_PRIVATE_PATTERN_BASENAMES`) — verifies which `.obsidian/*` files round-trip.
4. **`plugin/src/vault/FsChangeListener.ts`** (L201 `applyChange`) — needs a dedup guard against local-originated echoes once the adapter starts firing triggers directly.
5. **`plugin/src/vault/VaultModelBuilder.ts`** (L307 `renameOne`, L259 `vault.trigger('delete')`, L289 `vault.trigger('modify')`) — already does the right thing for remote-originated changes; reuse for local-originated.

## Recommended action plan

| Step | What | Where |
|------|------|-------|
| 1 | Ship Option A for #341 in 1.0.49: fire `vault.trigger('rename', ...)` from `SftpDataAdapter.rename()`, dedup against FsChangeListener echo. | `plugin/src/adapter/SftpDataAdapter.ts` |
| 2 | Ship Option A for #342 in 1.0.49: `seedObsidianConfig` step pulls allowlisted shared config from remote before spawn. | `plugin/src/shadow/ShadowVaultBootstrap.ts` |
| 3 | Drop the `it.fails(...)` markers from the sync-test framework as part of each fix PR — that's the regression guard going forward. | `plugin/tests/integration/{self-reflect,restart-roundtrip,invariants}*.e2e.test.ts` |
| 4 | Open an RFC discussion: "RemoteFs as the single sync dispatcher" — design doc that subsumes both fixes and the v1.1 multi-transport direction. | new GH discussion |
