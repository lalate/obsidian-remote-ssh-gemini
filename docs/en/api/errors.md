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
    "message": "method not found: fs.banana"
  }
}
```

(The spec reserves an optional `data` field too, but the current daemon never populates it — see [Error data field](#error-data-field) below.)

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

The JSON-RPC `error` envelope reserves a `data` field, but the current daemon always sets it to nil — and the Go encoder uses `omitempty`, so the field is **omitted from the wire entirely**. Path / OS-level context is embedded in the error's `message` string instead. Treat `data` as reserved for future use; do not parse it.

Clients should map error `code` to localized strings, not match on the message text.

Next: [[en/security/model|Security — threat model]].
