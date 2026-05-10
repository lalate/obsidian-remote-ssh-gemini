---
title: Error codes
tags: [api, reference]
---

# Error codes

JSON-RPC errors return:

```json
{
  "jsonrpc": "2.0",
  "id": <request id>,
  "error": {
    "code": -32601,
    "message": "Method not found",
    "data": { ... }   // optional, type depends on error
  }
}
```

## Standard JSON-RPC errors (-32700 to -32600)

| Code | Name | When |
|---|---|---|
| -32700 | ParseError | JSON parse failure |
| -32600 | InvalidRequest | Malformed JSON-RPC envelope |
| -32601 | MethodNotFound | Unknown method name |
| -32602 | InvalidParams | Params don't match method signature |
| -32603 | InternalError | Unexpected server error |

## Authentication errors (-32000, -32001)

| Code | Name | When |
|---|---|---|
| -32000 | AuthRequired | Non-`auth` method called before authentication |
| -32001 | AuthInvalid | Wrong token in `auth` call (closes connection) |

## Filesystem errors (-32010 to -32015)

| Code | Name | When |
|---|---|---|
| -32010 | FileNotFound | Path does not exist |
| -32011 | NotADirectory | `fs.list` / `fs.rmdir` target is a file |
| -32012 | IsADirectory | File-only operation on directory |
| -32013 | Exists | Create-like op found path already present |
| -32014 | PermissionDenied | OS rejected operation (mode, quota, etc.) |
| -32015 | PathOutsideVault | Resolved path escapes vault root |

`PathOutsideVault` is the rejection for `..`, leading `/`, or absolute paths. The check resolves symlinks before matching, so a symlink targeting `/etc/passwd` cannot escape.

## Concurrency / preconditions (-32020, -32021)

| Code | Name | When |
|---|---|---|
| -32020 | PreconditionFailed | `expectedMtime` did not match current; conflict |
| -32021 | ProtocolVersionTooOld | `server.info` returned incompatible version |

`PreconditionFailed` is the foundation of [[en/user-guide/conflicts|conflict handling]] — clients optimistically try `fs.write` with their last-known mtime; the daemon rejects the write if someone else modified the file in between, and the client surfaces a resolution UI.

## Error data field

Most errors include `data` with at least `path` (the path involved) and `errno` (the underlying OS errno when relevant):

```json
{
  "code": -32014,
  "message": "permission denied",
  "data": { "path": "secrets/key", "errno": 13, "syscall": "open" }
}
```

This is meant for debugging, not user-facing messages — clients should map error codes to localized strings, not parse `data`.

Next: [[en/security/model|Security — threat model]].
