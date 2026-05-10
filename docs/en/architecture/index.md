---
title: Architecture
tags: [architecture]
---

# Architecture

Design specs for the major subsystems. These document **why** decisions were made, not just **what** the code does.

## Documents

| Doc | What it covers |
|---|---|
| [[shadow-vault\|Shadow vault]] | The "local Obsidian vault that mirrors remote" model — shadow lifecycle, file routing, sync events |
| [[perf\|Performance]] | Sync latency budget, perf bench, the per-merge baseline tracking on `perf-baseline` branch |
| [[collab\|Collaboration]] | Multi-client editing, conflict handling, the per-client `.obsidian/user/<id>/` workspace partition |

## Common threads across all three

### "Daemon as the trust + data boundary"

The daemon is the only thing that touches the actual vault files. The plugin never SFTPs files in/out for editing — it always goes through `fs.*` RPCs. This:

- Centralises the path-safety check (`PathOutsideVault`).
- Lets the daemon enforce per-write `expectedMtime` preconditions (the conflict mechanism).
- Funnels the inotify watch firehose through one RPC channel so the plugin doesn't have to re-establish OS-level watches on every reconnect (event coalescing/debouncing for UI sanity is the plugin's job — see [[en/api/watch|api/watch]]).

### "Shadow vault is a real local vault"

Obsidian's plugin API is opinionated about vault paths. Rather than forking Obsidian's vault layer to be remote-aware (a multi-month investment), the shadow vault model just creates a real vault on your local disk and syncs files. Every Obsidian feature works without modification.

The cost: storage on your local machine grows with what you have opened. The plugin keeps a hot cache of recently-touched files; LRU eviction frees space for files not opened in N days.

### "Pre-1.0 stability promises"

The wire protocol is **frozen at version 1**. Method additions are non-breaking (capabilities-gated — see [[en/api/overview|API overview]]). Breaking changes ship as new methods, never modifications of existing ones. This means an old plugin can talk to a new daemon (and vice versa) for the lifetime of v1.

Shadow vault structure is similarly stable: changing it requires migrating every user's local cache, which we will not do without a strong reason.

## See also

- [[en/api/overview|API & protocol reference]] — the wire-level details
- [[en/security/model|Security threat model]] — what we defend against
- [[en/contributing/documentation|Contributing docs]] — when to add an architecture doc vs. update an existing one
