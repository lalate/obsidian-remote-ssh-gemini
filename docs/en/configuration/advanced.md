---
title: Advanced
tags: [configuration, reference]
---

# Configuration reference — Advanced

Lower-level toggles, mostly for debugging or unusual deployment topologies.

## Settings

| Field | Type | Default | Range | Description |
|---|---|---|---|---|
| Debug logging | boolean | `false` | — | Writes verbose JSONL traces to `<plugin>/logs/`. Adds developer-console output. Useful for [[en/operations/troubleshooting\|troubleshooting]]. |
| Reconnect attempts after unexpected disconnect | number | `5` | 0–100 | Auto-retry budget after a dropped connection. 0 disables auto-reconnect. Exponential backoff (1s, 2s, 4s, 8s, 16s, capped at 30s). |

## Telemetry (separate panel)

| Field | Type | Default | Description |
|---|---|---|---|
| Enable anonymous telemetry | boolean | `false` | Local-only opt-in counters for errors, reconnects, sync events. **Nothing leaves your machine** — counters are persisted as JSONL under `<plugin>/telemetry/` for your own diagnosis. |

The telemetry panel offers View / Flush / Reset.

## Daemon panel

Appears in **Settings** when an RPC profile has an active daemon.

| Action | What it does |
|---|---|
| Status badge | Shows "Running" or "Down" + version + capabilities count |
| Restart | Kills the daemon and re-deploys |
| View log | Shows last 50 lines of `~/.obsidian-remote/server.log` |

Next: [[en/server/overview|Server / deploy guide]].
