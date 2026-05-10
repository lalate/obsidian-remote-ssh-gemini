---
title: Authentication
tags: [api, reference]
---

# Authentication

Two methods. `auth` MUST be the first call on every connection. `server.info` MUST be the second so client + daemon agree on protocol version.

## `auth`

| Direction | client → server |
|---|---|
| Params | `{ token: string }` |
| Result | `{ ok: true }` |
| Errors | `AuthInvalid (-32001)` if token is wrong |

The token is the contents of the daemon's token file (default `~/.obsidian-remote/token`), 32 random bytes generated at daemon startup, mode `0600`. Plugin reads it via SFTP after spawning the daemon.

A successful `auth` pins the connection to one client identity. Re-`auth` with a different token closes the connection — the daemon does not multiplex sessions.

```json
// → request
{"jsonrpc": "2.0", "id": 1, "method": "auth", "params": {"token": "abc...32 bytes"}}

// ← response
{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}
```

## `server.info`

| Direction | client → server |
|---|---|
| Params | `{}` |
| Result | `ServerInfo` (see [[en/api/overview\|overview]]) |
| Errors | `AuthRequired (-32000)` if called before `auth` |

```json
// → request
{"jsonrpc": "2.0", "id": 2, "method": "server.info", "params": {}}

// ← response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "version": "0.1.0",
    "protocolVersion": 1,
    "capabilities": ["fs.stat", "fs.exists", "fs.list", "fs.walk", "fs.read*", "fs.write*", "fs.mkdir", "fs.remove", "fs.rmdir", "fs.rename", "fs.copy", "fs.trashLocal", "fs.thumbnail", "fs.watch"],
    "vaultRoot": "/home/pi/notes"
  }
}
```

The client compares `protocolVersion` against `PROTOCOL_VERSION` and bails with `ProtocolVersionTooOld (-32021)` on mismatch.

Capabilities let the client feature-detect: `fs.thumbnail` is optional (added in 0.1.0; older daemons would lack it). New methods land here; never assume a method exists without checking.

Next: [[en/api/filesystem|Filesystem operations]].
