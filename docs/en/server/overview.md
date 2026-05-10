---
title: Server overview
tags: [server, deploy]
---

# Server / deploy — overview

The server side is a single Go binary (`obsidian-remote-server`) that:

- Listens on a Unix socket (default `~/.obsidian-remote/server.sock`).
- Authenticates clients via a token file at `~/.obsidian-remote/token` (32 random bytes, mode 0600, generated at startup).
- Speaks JSON-RPC 2.0 (see [[en/api/overview|API & protocol]]).
- Runs under your remote user — no root, no setuid, no system service required.

## Three ways to run it

| Path | Effort | When |
|---|---|---|
| **[[en/server/auto-deploy\|Plugin auto-deploy]]** (default) | zero | You have shell access and want it to "just work" |
| **[[en/server/docker\|Docker]]** | low | Sandbox sshd + daemon for testing or hosting a vault for many users |
| **[[en/server/systemd\|systemd]]** | medium | The daemon should outlive plugin reconnects, or pre-deploy across many hosts |

The plugin auto-deploys for 99% of single-user setups. Docker/systemd are for shared hosts, CI, or operators who want explicit lifecycle control.

## Binary inventory (per release)

| File | Purpose |
|---|---|
| `obsidian-remote-server-linux-amd64` | x86-64 Linux daemon |
| `obsidian-remote-server-linux-arm64` | ARM64 Linux (RPi 4/5, Graviton) |
| `obsidian-remote-server-darwin-amd64` | macOS Intel |
| `obsidian-remote-server-darwin-arm64` | macOS Apple Silicon |
| `daemon-manifest.json` | `{filename: sha256}` map for all binaries |
| `*.bundle` | Cosign signature for each binary + manifest |

Statically linked (CGO_ENABLED=0). No runtime deps beyond a Linux/macOS kernel.

See [[en/security/cosign-verify|Cosign verify]] to check a binary you downloaded.

## What the daemon needs

- **Read+write** access to the configured vault root.
- **Bind permission** for the Unix socket (in `~/.obsidian-remote/` by default).
- **CPU, memory**: ~5 MB RSS idle; rises with watcher subscriptions and concurrent transfers. RPi Zero 2 W handles a moderate vault; RPi 4 effortless.
- **Network**: nothing. The daemon binds a local Unix socket. The plugin tunnels it through SSH; no port exposure required on the remote.

Next: [[en/server/auto-deploy|Auto-deploy]] / [[en/server/docker|Docker]] / [[en/server/systemd|systemd]].
