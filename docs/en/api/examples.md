---
title: API examples
tags: [api, reference, examples]
---

# API examples

Copy-pasteable JSON-RPC envelopes for the most common methods. Field names + shapes are taken directly from `server/internal/proto/types.go` so they match the wire exactly.

For the broader protocol reference (framing, paths, error codes), see [[en/api/overview|API overview]].

## Handshake

Every connection starts with these two calls before any `fs.*` method.

```json
// → request: authenticate
{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"abc...64hex"}}

// ← response
{"jsonrpc":"2.0","id":1,"result":{"ok":true}}

// → request: capability + version handshake
{"jsonrpc":"2.0","id":2,"method":"server.info","params":{}}

// ← response — `capabilities` is sorted alphabetically by the daemon
//   and includes EVERY registered method (auth + server.info too)
{
  "jsonrpc":"2.0","id":2,
  "result":{
    "version":"0.1.0",
    "protocolVersion":1,
    "capabilities":["auth","fs.append","fs.appendBinary","fs.copy","fs.exists","fs.list","fs.mkdir","fs.readBinary","fs.readBinaryRange","fs.readText","fs.remove","fs.rename","fs.rmdir","fs.stat","fs.thumbnail","fs.trashLocal","fs.unwatch","fs.walk","fs.watch","fs.write","fs.writeBinary","server.info"],
    "vaultRoot":"/home/pi/notes"
  }
}
```

## Read

### Stat one path

```json
// → request
{"jsonrpc":"2.0","id":3,"method":"fs.stat","params":{"path":"notes/today.md"}}

// ← response (file exists)
{
  "jsonrpc":"2.0","id":3,
  "result":{"type":"file","mtime":1715333412000,"size":1284,"mode":420}
}

// ← response (file does not exist) — null is the success case
{"jsonrpc":"2.0","id":3,"result":null}
```

### List a directory

```json
// → request
{"jsonrpc":"2.0","id":4,"method":"fs.list","params":{"path":"notes"}}

// ← response
{
  "jsonrpc":"2.0","id":4,
  "result":{
    "entries":[
      {"name":"today.md","type":"file","mtime":1715333412000,"size":1284},
      {"name":"archive","type":"folder","mtime":1715200000000,"size":0}
    ]
  }
}
```

### Walk recursively

```json
// → request
{
  "jsonrpc":"2.0","id":5,"method":"fs.walk",
  "params":{"path":"notes","recursive":true,"maxEntries":1000}
}

// ← response
{
  "jsonrpc":"2.0","id":5,
  "result":{
    "entries":[
      {"path":"notes/today.md","type":"file","mtime":1715333412000,"size":1284},
      {"path":"notes/archive","type":"folder","mtime":1715200000000,"size":0},
      {"path":"notes/archive/old.md","type":"file","mtime":1715100000000,"size":512}
    ],
    "truncated":false
  }
}
```

> `recursive` defaults to `false` (the Go zero value) — set `true` explicitly to descend.
> `truncated` is `true` when `maxEntries` was reached before the walk completed.

### Read text

```json
// → request
{"jsonrpc":"2.0","id":6,"method":"fs.readText","params":{"path":"notes/today.md"}}

// ← response
{
  "jsonrpc":"2.0","id":6,
  "result":{
    "content":"# Today\n\nMeeting notes...\n",
    "mtime":1715333412000,
    "size":1284,
    "encoding":"utf8"
  }
}
```

### Read binary

```json
// → request
{"jsonrpc":"2.0","id":7,"method":"fs.readBinary","params":{"path":"images/diagram.png"}}

// ← response
{
  "jsonrpc":"2.0","id":7,
  "result":{
    "contentBase64":"iVBORw0KGgoAAAANSUhEUgAA...",
    "mtime":1715333000000,
    "size":24576
  }
}
```

### Read partial binary

For large files (or thumbnail logic), pull a byte range:

```json
// → request: bytes [0, 4096) of a 100 MB file
{
  "jsonrpc":"2.0","id":8,"method":"fs.readBinaryRange",
  "params":{"path":"big.bin","offset":0,"length":4096}
}

// ← response — note `size` is the FULL file size, content is just the slice
{
  "jsonrpc":"2.0","id":8,
  "result":{
    "contentBase64":"AAAAAAAA...4096-bytes...",
    "mtime":1715300000000,
    "size":104857600
  }
}
```

`expectedMtime` (optional) makes the read fail with `PreconditionFailed (-32020)` if the file changed mid-stream — useful when chunking through a multi-call download.

## Write

### Atomic text write with conflict detection

```json
// → request: write only if mtime is still 1715333412000
{
  "jsonrpc":"2.0","id":9,"method":"fs.write",
  "params":{
    "path":"notes/today.md",
    "content":"# Today\n\nUpdated content\n",
    "expectedMtime":1715333412000
  }
}

// ← response (write succeeded)
{"jsonrpc":"2.0","id":9,"result":{"mtime":1715333500000}}

// ← response (someone else modified it first)
{
  "jsonrpc":"2.0","id":9,
  "error":{
    "code":-32020,
    "message":"precondition failed: mtime mismatch (expected 1715333412000, current 1715333450000)"
  }
}
```

> The write is atomic (tmp file + rename), so a crashed daemon never leaves a half-written file.
> Omit `expectedMtime` when you don't care about clobbering — fresh writes from a clean slate.

### Append

```json
{
  "jsonrpc":"2.0","id":10,"method":"fs.append",
  "params":{"path":"daily/log.md","content":"\n- new entry at 14:32\n"}
}

// ← response
{"jsonrpc":"2.0","id":10,"result":{"mtime":1715333612000}}
```

## Tree mutations

### mkdir -p

```json
// → request
{
  "jsonrpc":"2.0","id":11,"method":"fs.mkdir",
  "params":{"path":"projects/2026/q2","recursive":true}
}

// ← response
{"jsonrpc":"2.0","id":11,"result":{}}
```

### Rename

```json
// → request
{
  "jsonrpc":"2.0","id":12,"method":"fs.rename",
  "params":{"oldPath":"notes/draft.md","newPath":"notes/published/post.md"}
}

// ← response
{"jsonrpc":"2.0","id":12,"result":{"mtime":1715333700000}}
```

Rename creates intermediate destination directories if needed.

### Trash

```json
// → request: move to <vaultRoot>/.trash/...
{"jsonrpc":"2.0","id":13,"method":"fs.trashLocal","params":{"path":"old/note.md"}}

// ← response
{"jsonrpc":"2.0","id":13,"result":{}}
```

## Watch

### Subscribe + receive

```json
// → request: watch a folder recursively
{
  "jsonrpc":"2.0","id":14,"method":"fs.watch",
  "params":{"path":"notes","recursive":true}
}

// ← response
{"jsonrpc":"2.0","id":14,"result":{"subscriptionId":"sub_abc123"}}

// ← server-pushed notification (note: NO id field — JSON-RPC notifications spec)
{
  "jsonrpc":"2.0",
  "method":"fs.changed",
  "params":{
    "subscriptionId":"sub_abc123",
    "path":"notes/today.md",
    "event":"modified",
    "mtime":1715333800000
  }
}
```

The current daemon emits only `created` / `modified` / `deleted` (no `renamed`). Renames surface as a `deleted` + `created` pair on the affected paths.

### Unsubscribe

```json
// → request
{"jsonrpc":"2.0","id":15,"method":"fs.unwatch","params":{"subscriptionId":"sub_abc123"}}

// ← response (idempotent — unknown id is silently OK)
{"jsonrpc":"2.0","id":15,"result":{}}
```

## Errors

A typical error response (no `data` field — the daemon always omits it via Go `omitempty`):

```json
{
  "jsonrpc":"2.0","id":99,
  "error":{
    "code":-32010,
    "message":"file not found: nonexistent/path.md"
  }
}
```

Full error catalogue: [[en/api/errors|API → Error codes]].

## Smoke-testing from the shell

If you want to poke the daemon directly (skip the plugin), open the Unix socket via `nc -U` or `socat`. The wire framing is **LSP-style**: a single `Content-Length:` header, blank line, then the JSON body — see `server/internal/rpc/frame.go`.

```bash
TOKEN=$(cat ~/.obsidian-remote/token)
SOCK=~/.obsidian-remote/server.sock

# Emit one LSP-framed JSON-RPC message:
#   Content-Length: <N>\r\n
#   \r\n
#   <N bytes of UTF-8 JSON>
frame() {
  local body="$1"
  printf 'Content-Length: %d\r\n\r\n%s' "${#body}" "$body"
}

# Authenticate + list root
{
  frame '{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"'"$TOKEN"'"}}'
  frame '{"jsonrpc":"2.0","id":2,"method":"fs.list","params":{"path":""}}'
} | nc -U "$SOCK"
```

For real client-side use, write a small JSON-RPC library that handles the header parsing + max-message-size cap — the daemon caps inbound messages at **16 MiB** (`DefaultMaxMessageBytes`) and closes the connection on a missing or malformed `Content-Length`.
