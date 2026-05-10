---
title: API overview
tags: [api, reference]
---

# API & protocol — overview

The daemon speaks **JSON-RPC 2.0** over a length-prefixed framing on a Unix socket. The plugin opens the socket via SSH local port-forward; you can also connect directly with any tool that speaks JSON-RPC over a Unix socket (curl with `--unix-socket`, websocat, custom tooling).

## Wire format

- **Transport**: Unix socket (default `~/.obsidian-remote/server.sock`)
- **Framing**: 4-byte big-endian length prefix + JSON payload
- **Encoding**: UTF-8 JSON
- **Spec**: [JSON-RPC 2.0](https://www.jsonrpc.org/specification)

## Sections

- **[[en/api/authentication|Authentication]]** — `auth(token)` handshake, `server.info`
- **[[en/api/filesystem|Filesystem]]** — `fs.stat`, `fs.read*`, `fs.write*`, `fs.list`, `fs.walk`, `fs.mkdir`, `fs.remove`, etc.
- **[[en/api/watch|Watch / notifications]]** — `fs.watch`, `fs.unwatch`, `fs.changed` (server-push)
- **[[en/api/errors|Error codes]]** — full error reference

## Protocol version

Currently **1**. The handshake's `server.info` returns a `protocolVersion` field; clients refuse to proceed if it's outside the range they support.

```typescript
interface ServerInfo {
  version: string;           // semver of the daemon binary, e.g. "0.1.0"
  protocolVersion: number;   // currently 1
  capabilities: string[];    // e.g. ["fs.stat", "fs.watch", "fs.thumbnail"]
  vaultRoot: string;         // absolute path on remote (informational)
}
```

Adding a method bumps `capabilities` (clients can feature-detect). Breaking changes to existing methods bump `protocolVersion`.

## Path conventions

All paths are **vault-relative**, **forward slashes only**:

- `notes/today.md` — fine
- `/notes/today.md` — leading slash rejected with `PathOutsideVault (-32015)`
- `../escape.md` — `..` rejected with `PathOutsideVault`
- `notes\today.md` — backslashes rejected (Windows-style separators are not normalised; the daemon is a Linux/macOS process)
- `""` or `"/"` — vault root

## Quick example

Connect, authenticate, list the root:

```bash
# Read the token (mode 0600, only your user can read it)
TOKEN=$(cat ~/.obsidian-remote/token)

# Frame helper: 4-byte length prefix + JSON
frame() {
  local json="$1"
  printf '%b' "$(printf '\x%02x' $((${#json} >> 24 & 0xff)) $((${#json} >> 16 & 0xff)) $((${#json} >> 8 & 0xff)) $((${#json} & 0xff)))$json"
}

# Authenticate, then fs.list
{
  frame '{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"'"$TOKEN"'"}}'
  frame '{"jsonrpc":"2.0","id":2,"method":"fs.list","params":{"path":""}}'
} | nc -U ~/.obsidian-remote/server.sock | xxd
```

(For real tooling, use a JSON-RPC library that handles framing; this is just for spot-checks.)

## Stability

Protocol version 1 is **frozen for the lifetime of the 1.x line**. Method additions are non-breaking (capabilities-gated). Param/result shape changes ship as new methods.

Next: [[en/api/authentication|Authentication]].
