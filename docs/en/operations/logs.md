---
title: Logs & telemetry
tags: [operations]
---

# Logs & telemetry

Three independent log streams. Knowing which one to look at is half the battle.

## 1. Plugin (client) logs

`<vault>/.obsidian/plugins/obsidian-remote-ssh/logs/`

- Format: JSONL, one event per line
- Rotated: by date, kept 14 days
- Enable verbose: **Settings** → **Advanced** → **Debug logging** = on

Useful fields per event: `ts`, `level`, `event`, `profileId`, `op`, `latencyMs`, plus event-specific data.

Quick filters:
```bash
# All errors today
grep '"level":"error"' "<vault>/.obsidian/plugins/obsidian-remote-ssh/logs/$(date +%F).jsonl"

# All ops slower than 500 ms
jq -c 'select(.latencyMs > 500)' "<vault>/.obsidian/plugins/obsidian-remote-ssh/logs/$(date +%F).jsonl"
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

Counters tracked:

| Counter | Meaning |
|---|---|
| `connect.success` | successful connects per profile |
| `connect.fail.{reason}` | failed connects, bucketed by reason |
| `reconnect.attempts` | exponential-backoff retries triggered |
| `rpc.{method}.success` | per-method success count |
| `rpc.{method}.fail.{code}` | per-method failure, bucketed by error code |
| `conflict.detected` | `fs.write` rejected with `PreconditionFailed` |
| `conflict.resolved.{keep-local|keep-remote|merged}` | how user resolved |

Persisted as JSONL under `<plugin>/telemetry/`. Rotated daily, kept 90 days. Nothing leaves your machine — there is no "send" button. The data is for your own diagnosis.

View / reset / flush from the telemetry panel.

## Correlating across streams

Each connect generates a `connectionId` (UUID). Both the plugin log and the daemon log include this. To trace one session end-to-end:

```bash
ID=$(grep '"event":"connect.start"' "<plugin>/logs/$(date +%F).jsonl" | tail -1 | jq -r '.connectionId')
echo "connectionId=$ID"

# plugin side
grep -c "$ID" "<plugin>/logs/$(date +%F).jsonl"

# daemon side (the daemon emits `[<ID>] ...` prefix)
ssh user@host "grep -c '$ID' ~/.obsidian-remote/server.log"
```

Useful when debugging an intermittent issue; gives you both halves of the conversation aligned.

Next: [[en/operations/reconnect|Reconnect behavior]].
