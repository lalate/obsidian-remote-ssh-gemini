---
title: Advanced
tags: [configuration, reference]
---

# Configuration reference — Advanced

Lower-level toggles, mostly for debugging or unusual deployment topologies.

## Settings

| Field | Type | Default | Range | Description |
|---|---|---|---|---|
| Debug logging | boolean | `false` | — | Writes verbose lines to `<plugin>/console.log` (rotated by size: 5 MB per file, keeps current + 3 backups). Adds developer-console output. Useful for [[en/operations/troubleshooting\|troubleshooting]]. |
| Reconnect attempts after unexpected disconnect | number | `5` | 0–100 | Auto-retry budget after a dropped connection. 0 disables auto-reconnect. Exponential backoff: starts at 1 s, multiplier ×1.5, ±20% jitter, capped at 30 s per attempt (so nominal: 1 s, 1.5 s, 2.25 s, 3.4 s, 5.1 s, …). |

## Telemetry (separate panel)

| Field | Type | Default | Description |
|---|---|---|---|
| Enable anonymous telemetry | boolean | `false` | Local-only opt-in counters: two event kinds (`error` with `category` + optional `code`; `reconnect` with `state`). **Nothing leaves your machine** — events are appended to `<plugin>/telemetry.jsonl` for your own diagnosis. |

The telemetry panel offers View / Flush / Reset.

## Daemon panel

Appears in **Settings** when an RPC profile has an active daemon.

| Action | What it does |
|---|---|
| Status badge | Shows "Running" or "Down" + version + capabilities count |
| Restart | Kills the daemon and re-deploys |
| View log | Shows last 50 lines of `~/.obsidian-remote/server.log` |

Next: [[en/server/overview|Server / deploy guide]].
