---
title: Architecture
tags: [architecture]
---

# Architecture

Design specs for the major subsystems — the **why** behind decisions, not just the **what** of the code. Read [[shadow-vault|Shadow vault]] first; it's the foundation the others build on.

## Documents

| Doc | What it covers |
|---|---|
| [[shadow-vault\|Shadow vault]] | The shadow-vault model (a local vault whose patched adapter serves the remote virtually) — lifecycle, file routing, change events |
| [[perf\|Performance]] | Sync latency budget, perf bench, the per-merge baseline tracking on `perf-baseline` branch |
| [[collab\|Collaboration]] | Multi-client editing, conflict handling, the per-client `.obsidian/user/<id>/` workspace partition |
| [[release-pipeline\|Release & deploy pipeline]] | Two-channel release model, `release.yml` signing flow, sync workflow, branch-aware lint/version-check, plugin-side deploy lifecycle |

## Common threads across all three

### "Daemon as the trust + data boundary"

The daemon is the only thing that touches the actual vault files. The plugin never SFTPs files in/out for editing — it always goes through `fs.*` RPCs. This:

- Centralises the path-safety check (`PathOutsideVault`).
- Lets the daemon enforce per-write `expectedMtime` preconditions (the conflict mechanism).
- Funnels the inotify watch firehose through one RPC channel so the plugin doesn't have to re-establish OS-level watches on every reconnect (event coalescing/debouncing for UI sanity is the plugin's job — see [[en/api/watch|api/watch]]).

### "Shadow vault is a real local vault"

Obsidian's plugin API is opinionated about vault paths. Rather than forking Obsidian's vault layer to be remote-aware (a multi-month investment), the shadow vault model creates a real local vault but patches its adapter so every file op goes to the remote — the notes are never copied to local disk (only `.obsidian/` lives there). Every Obsidian feature works without modification.

The cost: file ops need the remote reachable and pay per-op SSH/RPC latency. An in-memory cache (capped) speeds re-reads of recently-touched files.

### v1.x stability promises

The wire protocol is **frozen at version 1**. Method additions are non-breaking (capabilities-gated — see [[en/api/overview|API overview]]). Breaking changes ship as new methods, never modifications of existing ones. This means an old plugin can talk to a new daemon (and vice versa) for the lifetime of v1.

Shadow vault structure is similarly stable: changing it requires migrating every user's local cache, which we will not do without a strong reason.

## See also

- [[en/api/overview|API & protocol reference]] — the wire-level details
- [[en/security/model|Security threat model]] — what we defend against
- [[en/contributing/documentation|Contributing docs]] — when to add an architecture doc vs. update an existing one
