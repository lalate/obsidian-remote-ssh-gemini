---
title: Troubleshooting
tags: [operations]
---

# Troubleshooting

Most failures fall into a small number of buckets. This page maps symptom to likely cause to fix.

## Connect fails immediately

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` | SSH auth wrong | Verify the key matches a line in remote `~/.ssh/authorized_keys`; `ssh -i <key> user@host` from a terminal first |
| `Host key verification failed` | Plugin known-host store rejected | Open settings → trust dialog. If a known host changed, see [[en/security/host-keys\|Host-key trust]] |
| `Connection refused` | sshd not listening | Verify the port; `nc -zv <host> <port>` to confirm reachability |
| `Connection timeout` | Network / firewall | Same hop reachable via `ping`? sshd port open in firewall? |
| `Daemon failed to start` (after binary upload) | Daemon crashed at startup | See **Daemon won't start** below |

## Daemon won't start

Check the daemon log: **Settings** → **Daemon** → "View log", or directly:
```bash
ssh user@host 'cat ~/.obsidian-remote/server.log'
```

Common patterns:

- `permission denied` opening the socket → check `~/.obsidian-remote/` exists with the right ownership; recreate with `mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote`.
- `bind: address already in use` on the socket → another daemon is already running. Kill it (`pkill -f obsidian-remote-server`) or pick a different socket path in the profile.
- `vault root does not exist` → set the profile's "Remote vault path" to a path that exists; the daemon won't create it.
- `inotify_add_watch: too many open files` → raise `fs.inotify.max_user_watches` (see [[en/api/watch|fs.watch caveats]]).

## Files don't sync

| Symptom | Cause | Fix |
|---|---|---|
| Local edits don't appear on remote | Plugin write is failing silently — open developer console (`Cmd+Opt+I` / `Ctrl+Shift+I`), look for `[remote-ssh]` errors | Often a permission issue on the remote vault dir |
| Remote edits don't appear locally | `fs.watch` subscription not active, or hit the `inotify` watch limit | Settings → Daemon → Restart; raise `fs.inotify.max_user_watches` (see [[en/api/watch\|fs.watch caveats]]) |
| Specific file always conflicts | Two-way edit collision | See [[en/user-guide/conflicts\|Conflict handling]] |
| Big binary files take forever | Plugin downloads on-demand; first open is slow | Expected — local cache survives across reopens |

## Performance feels slow

Likely culprits, in order of frequency:

1. **High SSH latency** — `ping <host>` to estimate RTT. Per-RPC RTT is roughly 2× ping. Anything > 50 ms makes typing feel laggy.
2. **inotify limits** — daemon can't subscribe to all dirs. Symptom: remote edits delay until you switch focus. Fix per [[en/api/watch|fs.watch]].
3. **Vault on slow disk** (SD card on Pi) — `fs.walk` cold-cache is the slowest op. Move to USB SSD if possible.
4. **First connect on a new host** — binary upload is one-time, ~5 MB. Subsequent connects skip it.

For deep perf debug: enable [[en/configuration/advanced|Debug logging]] and check `<plugin>/console.log` (rotated `console.log` + `.1` + `.2` + `.3`) for per-op timings.

The full perf-tuning playbook (network / disk / inotify / daemon-side cache, with measurement commands) lives at [[en/operations/performance-tuning|Performance tuning]].

## How to ask for help

When opening an issue, paste:

1. **Plugin version**: Settings → Community plugins → "Remote SSH" entry shows the version.
2. **Daemon version**: Settings → Daemon panel → status badge.
3. **Plugin log** (last 50 lines from `<vault>/.obsidian/plugins/remote-ssh/console.log`).
4. **Daemon log** (last 50 lines from `~/.obsidian-remote/server.log`).
5. **Local OS** + **remote OS / arch** (`uname -a` on remote).
6. **What you expected vs what happened.**

Issues at: [github.com/sotashimozono/obsidian-remote-ssh/issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues).

Next: [[en/operations/logs|Logs & telemetry]].
