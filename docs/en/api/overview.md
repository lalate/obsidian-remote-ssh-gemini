---
title: API overview
tags: [api, reference]
description: "obsidian-remote-ssh JSON-RPC 2.0 protocol reference. LSP-style framing on a Unix socket, auth handshake, server.info, fs.* method namespace, capabilities-gated extensions."
---

# API & protocol — overview

The daemon speaks **JSON-RPC 2.0** with **LSP-style framing** on a Unix socket. The plugin opens the socket via SSH local port-forward; you can also connect directly with any tool that can write LSP-framed JSON-RPC over a Unix socket.

## Wire format

- **Transport**: Unix socket (default `~/.obsidian-remote/server.sock`)
- **Framing**: `Content-Length: <N>\r\n\r\n<N bytes of UTF-8 JSON>` per message — same as the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart). Unknown headers are silently ignored for forward-compat; missing or malformed `Content-Length` closes the connection.
- **Max message size**: 16 MiB (server-side cap; oversized messages close the connection)
- **Encoding**: UTF-8 JSON
- **Spec**: [JSON-RPC 2.0](https://www.jsonrpc.org/specification)

## Sections

- **[[en/api/authentication|Authentication]]** — `auth(token)` handshake, `server.info`
- **[[en/api/filesystem|Filesystem]]** — `fs.stat`, `fs.read*`, `fs.write*`, `fs.list`, `fs.walk`, `fs.mkdir`, `fs.remove`, etc.
- **[[en/api/watch|Watch / notifications]]** — `fs.watch`, `fs.unwatch`, `fs.changed` (server-push)
- **[[en/api/errors|Error codes]]** — full error reference
- **[[en/api/examples|Examples]]** — copy-pasteable JSON-RPC envelopes for every common operation
- **[[en/api/protocol-evolution|Protocol evolution & versioning]]** — what's a breaking change vs capabilities-gated, the strict-equality regime, future-bump triggers

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

# LSP-style frame: Content-Length: <N>\r\n\r\n<body>
frame() {
  local body="$1"
  printf 'Content-Length: %d\r\n\r\n%s' "${#body}" "$body"
}

# Authenticate, then fs.list
{
  frame '{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"'"$TOKEN"'"}}'
  frame '{"jsonrpc":"2.0","id":2,"method":"fs.list","params":{"path":""}}'
} | nc -U ~/.obsidian-remote/server.sock
```

(For real tooling, use a JSON-RPC library that handles header parsing — this is just for spot-checks.)

## Stability

Protocol version 1 is **frozen for the lifetime of the 1.x line**. Method additions are non-breaking (capabilities-gated). Param/result shape changes ship as new methods.

Next: [[en/api/authentication|Authentication]].
