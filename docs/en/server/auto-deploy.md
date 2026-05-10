---
title: Plugin auto-deploy
tags: [server, deploy]
---

# Plugin auto-deploy

This is the default. When you connect via an RPC profile, the plugin uploads the daemon binary to the remote and starts it under your SSH user. Nothing to do upfront.

## What happens, in order

1. **Resolve remote paths**. Every path is absolutised against the remote's HOME — never hardcoded. Defaults:
   - Binary: `~/.obsidian-remote/server`
   - Socket: `~/.obsidian-remote/server.sock`
   - Token: `~/.obsidian-remote/token`
   - Log: `~/.obsidian-remote/server.log`

2. **Kill prior daemon** (`pkill -f` against suffix-form binary path — matches both relative and absolute argv).

3. **Create directory**: `mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote`.

4. **Upload binary** via SFTP (~5 MB, fast on LAN, ~2-3s on slow links).

5. **SHA256 verify**: plugin computes hash locally, runs `sha256sum` on remote, fails connect if they differ. Catches transport corruption and (less commonly) hostile MITM swaps.

6. **Start daemon** (one nohup line piping stdout/stderr into `~/.obsidian-remote/server.log`, stdin closed).

7. **Wait for token**: the daemon writes a 32-byte token to `~/.obsidian-remote/token` (mode 0600) at startup. Plugin polls (every 150 ms, default 5s deadline).

8. **Open RPC tunnel**: SSH local port-forward to the Unix socket, send `auth(token)`, then `server.info` for handshake.

## Tuning

Per-profile overrides under **Profile** → **Transport**:

| Field | Default | Override when |
|---|---|---|
| Daemon binary path | `~/.obsidian-remote/server` | The remote HOME is on slow disk; want binary on `/var/tmp/obsidian-remote/` |
| Daemon socket path | `~/.obsidian-remote/server.sock` | Multiple users sharing one OS account, each needing their own socket (advanced) |
| Daemon token path | `~/.obsidian-remote/token` | (Almost never) |

## What if I do not want auto-deploy?

If you would rather pre-install the daemon (Docker, systemd) and have the plugin attach instead of redeploying:

1. Pre-stage the binary at the path the plugin expects (default `~/.obsidian-remote/server`).
2. Start it with the same flags shown in `~/.obsidian-remote/server.log` after one auto-deploy.
3. The plugin's "kill prior + redeploy" logic still runs by default. To disable: set the (planned) `Reuse existing daemon` profile flag.

> Roadmap: a "reuse existing daemon" profile flag — until then, the kill-and-redeploy step always runs.

Next: [[en/server/docker|Docker]] for sandbox / shared hosts.
