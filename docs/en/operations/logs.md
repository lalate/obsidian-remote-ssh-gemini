---
title: Logs & telemetry
tags: [operations]
---

# Logs & telemetry

Three independent log streams. Knowing which one to look at is half the battle.

## 1. Plugin (client) logs

`<vault>/.obsidian/plugins/remote-ssh/console.log`

- Format: free-form lines (matches what Obsidian's developer console shows)
- Rotated: by size — 5 MB per file × 3 generations (`console.log`, `console.log.1`, `console.log.2`)
- Enable verbose: **Settings** → **Advanced** → **Debug logging** = on

Quick filters:
```bash
LOG="<vault>/.obsidian/plugins/remote-ssh/console.log"

# Errors
grep -i 'error\|fail' "$LOG"

# Recent connect attempts
grep -i 'connect' "$LOG" | tail -20
```

## 2. Daemon (server) logs

`~/.obsidian-remote/server.log` on the remote (or `journalctl --user -u obsidian-remote-server` if running under [[en/server/systemd|systemd]]).

- Format: line-oriented; one log line per event
- Rotated: not yet — the daemon truncates on each restart
- Enable verbose: daemon flag `--verbose` (auto-deploy passes this)

Quick spot checks:
```bash
# Tail in real time
ssh user@host 'tail -f ~/.obsidian-remote/server.log'

# Filter for errors
ssh user@host 'grep -i error ~/.obsidian-remote/server.log'
```

The daemon panel in plugin settings shows the last 50 lines as a one-click view.

## 3. Telemetry counters (opt-in, local-only)

Enable in **Settings** → **Telemetry** → "Enable anonymous telemetry".

Two event kinds are recorded:

| Event kind | Fields | When |
|---|---|---|
| `error` | `category`, optional `code` | An error surfaces (auth failure, RPC failure, conflict, etc.); the category bucket lets you spot regressions per area |
| `reconnect` | `state` (one of: `idle`, `waiting`, `attempting`, `recovered`, `failed`, `cancelled`) | The reconnect manager transitions through the lifecycle after a transport drop |

Persisted to a single file `<plugin>/telemetry.jsonl`. Nothing leaves your machine — there is no "send" button.

View / reset / flush from the telemetry panel.

## Correlating across streams

The plugin and daemon both emit a 16-char hex `cid` on file-change events (`fs.changed` notifications) so you can match an in-Obsidian "remote modified" notice with the daemon-side watcher event that produced it. For broader session correlation, use timestamps + the per-profile name printed at connect — there is no shared session UUID across the two log streams.

Useful when debugging an intermittent issue; gives you both halves of the conversation aligned.

Next: [[en/operations/reconnect|Reconnect behavior]].
