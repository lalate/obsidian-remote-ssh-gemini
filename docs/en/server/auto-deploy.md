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

2. **Try to reuse an existing daemon** (`tryReuseExistingDaemon` in `plugin/src/transport/DaemonProbe.ts`):
   - `test -S <socket>` — does a Unix socket exist at the expected path?
   - Read the token file via SFTP.
   - Open a Unix-socket stream + send `auth(token)` + `server.info`.
   - If all four steps succeed → **skip the rest of the deploy flow** and use the running daemon. Subsequent connects within ~5 minutes hit this path and finish in ~1 second.

3. If reuse failed (no socket, bad token, version mismatch, etc.) — fall through to deploy:
   - **Kill any partial prior daemon** (`pkill -f` against suffix-form binary path — matches both relative and absolute argv).
   - **Create directory**: `mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote`.
   - **Upload binary** via SFTP (~5 MB, fast on LAN, ~2-3s on slow links).
   - **SHA256 verify**: plugin computes hash locally, runs `sha256sum` on remote, fails connect if they differ. Catches transport corruption and (less commonly) hostile MITM swaps.
   - **Start daemon** (one nohup line piping stdout/stderr into `~/.obsidian-remote/server.log`, stdin closed).
   - **Wait for token**: the daemon writes a 32-byte token to `~/.obsidian-remote/token` (mode 0600) at startup. Plugin polls (every 150 ms, default 5s deadline).

4. **Open RPC tunnel**: SSH local port-forward to the Unix socket, send `auth(token)`, then `server.info` for handshake.

## Tuning

Per-profile overrides under **Profile** → **Transport**:

| Field | Default | Override when |
|---|---|---|
| Daemon binary path | `~/.obsidian-remote/server` | The remote HOME is on slow disk; want binary on `/var/tmp/obsidian-remote/` |
| Daemon socket path | `~/.obsidian-remote/server.sock` | Multiple users sharing one OS account, each needing their own socket (advanced) |
| Daemon token path | `~/.obsidian-remote/token` | (Almost never) |

## What if I do not want auto-deploy?

You don't need any opt-in flag — the reuse path (step 2 above) already attaches to a pre-existing daemon when one is healthy. The recipe is simply:

1. Pre-stage the binary at the path the plugin expects (default `~/.obsidian-remote/server`) via Docker / systemd / your own deployment.
2. Start it with the same flags shown in `~/.obsidian-remote/server.log` after one auto-deploy (`--vault-root` / `--socket` / `--token-file`).
3. Connect from the plugin. The reuse probe finds the live socket + valid token and skips the binary upload entirely.

If reuse fails (token missing, version mismatch with the bundled daemon, socket stale), the plugin falls through to deploy — your pre-staged binary will be killed + replaced. To prevent that fallback you can either:

- Keep your binary version pinned to whatever the plugin bundle was built against (so the version handshake passes), or
- Run your daemon under a different binary path / socket path than the plugin's defaults and configure those paths in the profile (the plugin will reuse those paths if healthy and only fall back to the defaults' deploy if not).

Next: [[en/server/docker|Docker]] for sandbox / shared hosts.
