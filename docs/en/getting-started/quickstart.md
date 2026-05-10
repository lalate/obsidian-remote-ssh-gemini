---
title: Quickstart
tags: [getting-started, quickstart]
---

# 5-minute quickstart

This walks you from "plugin installed" to "editing a file on a remote vault" in five minutes. Assumes you already have:

- obsidian-remote-ssh installed (see [[en/getting-started/install|Install]])
- An SSH-reachable Linux/macOS host with your public key in `~/.ssh/authorized_keys` on it
- A directory on that host you want to use as a vault (it can be empty)

If any of those is missing, the [[en/server/docker|Docker quickstart server]] gets you a sandbox in one command.

## 1. Open the plugin settings

**Settings** → **Community plugins** → **Obsidian Remote SSH** → ⚙️.

## 2. Add an SSH profile

Click **Add profile** and fill in:

| Field | Example | Notes |
|---|---|---|
| Profile name | `My Pi` | Display label only |
| Host | `192.168.1.50` or `pi.local` | Anything `ssh` would accept |
| Port | `22` | Default 22 |
| Username | `pi` | Remote user |
| Authentication | `Private key` | See [[en/configuration/profiles#authentication\|auth options]] |
| Private key path | `~/.ssh/id_ed25519` | Tilde-expanded at runtime |
| Remote vault path | `/home/pi/notes` or `~/notes` | Must exist on the remote |
| Mode | `RPC daemon` | The default; auto-deploys the signed server binary |

Click **Save**.

## 3. Connect

Either:

- Open the **command palette** (⌘P / Ctrl+P) → type "Remote SSH: Connect" → pick your profile, **or**
- Click the **Remote SSH** ribbon icon and select your profile from the menu.

What happens next:

1. Plugin opens an SSH connection over your existing keys/agent.
2. Plugin **uploads the daemon binary** to `~/.obsidian-remote/server` (~5 MB) and verifies its SHA256.
3. Plugin **starts the daemon** under your remote user. The daemon listens on a Unix socket; the plugin tunnels it back through SSH.
4. Plugin **opens a new "shadow vault" window** that reads/writes the remote files via the daemon.

The first connect takes ~5–8 seconds (binary upload). Subsequent connects reuse the running daemon and finish in ~1 second.

## 4. Verify

In the new window:

- Create a file → confirm it appears on the remote with `ls`.
- Edit a file on the remote (`echo hello >> README.md`) → see the change reflected in Obsidian within ~500 ms.

## 5. Disconnect

**Command palette** → "Remote SSH: Disconnect" — or just close the shadow vault window. The daemon keeps running for ~5 minutes after disconnect (configurable) so a quick reconnect is instant.

## What if it didn't work?

- **Auth failed**: check your private key path / SSH agent — the plugin uses your existing SSH config, not its own credential store.
- **Daemon won't start**: check the daemon panel in settings (⚙️ → Daemon) → "View log".
- **Files don't appear**: confirm the remote vault path exists. The daemon does NOT auto-create it (it's protective — see [[en/operations/troubleshooting|Troubleshooting]]).

Continue: [[en/getting-started/first-connect|First connect — what's actually happening]].
