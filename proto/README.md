# proto

Shared JSON-RPC protocol between the obsidian-remote-ssh plugin
(TypeScript) and the obsidian-remote-server daemon (Go).

## Transport

- **Length-prefixed JSON messages** (LSP-style framing) over a unix
  socket. One message per frame; no WebSocket or HTTP on this channel.
    ```
    Content-Length: <bytes>\r\n
    \r\n
    <JSON body>
    ```
- The plugin opens a local TCP connection that SSH forwards to the
  daemon's unix socket (`ssh -L <port>:<sockpath> …`). Nothing is
  exposed to the network.
- The framing handles multi-MB payloads cleanly and lets both sides
  reject oversized messages up front (future limit, configurable).
- Binary payloads (file bytes) are base64-encoded inside the JSON
  body. MVP trade-off: +33% wire overhead for a much simpler client.
  Attachment serving for `getResourcePath` lives on a separate HTTP
  channel on a second forwarded port (Phase 5-F); this channel is
  always framed JSON.

## Handshake

Before any `fs.*` method succeeds, the client must authenticate:

```
→ { "jsonrpc": "2.0", "id": 1, "method": "auth", "params": { "token": "…" } }
← { "jsonrpc": "2.0", "id": 1, "result": { "ok": true } }
```

- The server writes `~/.obsidian-remote/token` (mode `0600`) at startup
  with a fresh 32-byte random token.
- The plugin reads that file over SSH (since SSH already authenticates
  the right user, and POSIX perms forbid other local users from
  reading it) and presents it here.
- A session is pinned to one authenticated client. Rejecting `auth`
  closes the connection.

After `auth` succeeds, the plugin should call `server.info` once to
check protocol compatibility.

## Versioning

The protocol version is an integer. The client is responsible for
refusing to proceed when the server advertises a version it does not
understand. Breaking changes bump the integer; additive changes do
not.

Current protocol version: **1**.

## Path conventions

All paths are **vault-relative** and use **forward slashes**.

- `"note.md"`, `"docs/sub/a.md"` — valid
- `""` or `"/"` — the vault root itself
- `"../"` or any `..` component — rejected with `PathOutsideVault`
- A leading `/` (absolute path) — rejected with `PathOutsideVault`

The vault root is fixed at server start via `--vault-root=<abs>`. The
server refuses to open any path that, once resolved, does not live
under that root.

## Methods

| Method              | Params                                        | Result                              |
|---------------------|-----------------------------------------------|-------------------------------------|
| `auth`              | `{ token }`                                    | `{ ok: true }`                      |
| `server.info`       | `{}`                                           | `ServerInfo`                        |
| `fs.stat`           | `{ path }`                                     | `Stat \| null`                      |
| `fs.exists`         | `{ path }`                                     | `{ exists: boolean }`               |
| `fs.list`           | `{ path }`                                     | `{ entries: Entry[] }`              |
| `fs.readText`       | `{ path, encoding? }`                          | `ReadTextResult`                    |
| `fs.readBinary`     | `{ path }`                                     | `ReadBinaryResult`                  |
| `fs.write`          | `{ path, content, expectedMtime? }`            | `{ mtime }`                         |
| `fs.writeBinary`    | `{ path, contentBase64, expectedMtime? }`      | `{ mtime }`                         |
| `fs.append`         | `{ path, content }`                            | `{ mtime }`                         |
| `fs.appendBinary`   | `{ path, contentBase64 }`                      | `{ mtime }`                         |
| `fs.mkdir`          | `{ path, recursive? }`                         | `{}`                                |
| `fs.remove`         | `{ path }`                                     | `{}`                                |
| `fs.rmdir`          | `{ path, recursive? }`                         | `{}`                                |
| `fs.rename`         | `{ oldPath, newPath }`                         | `{ mtime }`                         |
| `fs.copy`           | `{ srcPath, destPath }`                        | `{ mtime }`                         |
| `fs.trashLocal`     | `{ path }`                                     | `{}`                                |
| `fs.watch`          | `{ path, recursive? }`                         | `{ subscriptionId }`                |
| `fs.unwatch`        | `{ subscriptionId }`                           | `{}`                                |
| `cli.exec`          | `{ cmd, args, cwd?, env? }`                   | `CliExecResult`                     |
| `cli.spawn`         | `{ id, cmd, args, cwd?, env? }`               | `{ ok: true }`                      |
| `cli.kill`          | `{ id }`                                      | `{}`                                |

Shapes:

```ts
interface ServerInfo {
  version: string;         // implementation version, e.g. "0.1.0"
  protocolVersion: number; // currently 1
  capabilities: string[];  // e.g. ["fs.stat", "fs.watch", …]
  vaultRoot: string;       // absolute path on the remote host (informational)
}

interface Stat {
  type: 'file' | 'folder';
  mtime: number;  // unix milliseconds
  size: number;   // bytes (0 for folders)
  mode: number;   // POSIX mode bits (informational)
}

interface Entry {
  name: string;   // basename only, no slashes
  type: 'file' | 'folder' | 'symlink';
  mtime: number;
  size: number;
}

interface ReadTextResult  { content: string;        mtime: number; size: number; encoding: 'utf8'; }
interface ReadBinaryResult { contentBase64: string; mtime: number; size: number; }

// ── cli.exec ──────────────────────────────────────────────────────────
interface CliExecParams {
  cmd: string;              // whitelisted binary name (e.g. "gemini", "git")
  args: string[];           // command-line arguments
  cwd?: string;             // vault-relative working dir; defaults to vault root
  env?: Record<string, string>; // extra env vars merged into the process environment
}
interface CliExecResult {
  stdout: string;           // full stdout captured after process exits
  stderr: string;           // full stderr captured after process exits
  exitCode: number;         // process exit code (0 = success)
}

// ── cli.spawn ─────────────────────────────────────────────────────────
interface CliSpawnParams {
  id: string;               // client-generated correlation id (e.g. UUID); must be unique per session
  cmd: string;              // whitelisted binary name
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}
interface CliSpawnResult {
  ok: boolean;              // always true on success; errors are returned as JSON-RPC errors
}

// ── cli.kill ──────────────────────────────────────────────────────────
interface CliKillParams {
  id: string;               // correlation id passed to cli.spawn
}
// cli.kill result: {} (empty object)
```

Atomicity notes:
- `fs.write` and `fs.writeBinary` are atomic on the remote (tmp file
  + rename). If `expectedMtime` is set and the current file's mtime
  does not match, the server rejects with `PreconditionFailed`.
- `fs.rename` creates the destination's parent directory if needed.
- `fs.copy` goes through the file contents (no server-side reflink).
- `fs.trashLocal` moves the path under `<vaultRoot>/.trash/…`,
  creating intermediate dirs as needed.

CLI notes:
- `cli.exec` / `cli.spawn` / `cli.kill` are auth-gated just like `fs.*`.
- The current daemon only permits whitelisted command names (`gemini`, `git`).
- `cwd` is vault-relative; omitted `cwd` defaults to the vault root.
- `env` adds/overrides process environment variables for the spawned command.

## Notifications (server → client)

The server pushes notifications on subscribed paths:

```
{
  "jsonrpc": "2.0",
  "method": "fs.changed",
  "params": {
    "subscriptionId": "…",
    "path": "note.md",
    "event": "created" | "modified" | "deleted",
    "mtime"?: number
  }
}
```

- The proto reserves a `renamed` event tag for future use, but the current
  daemon emits only `created` / `modified` / `deleted`. Renames surface as
  a `deleted` + `created` pair on the affected paths.
- The current daemon does NOT debounce or coalesce events server-side;
  every inotify event maps to one `fs.changed` notification. Clients should
  debounce on their side if they want UI-friendly throttling.
- An `fs.watch` subscription with `recursive: true` emits events for
  every descendant.

CLI streaming notifications:

```ts
// Emitted once per stdout/stderr chunk while the spawned process is running.
interface CliOutputParams {
  id: string;               // correlation id from cli.spawn
  stream: 'stdout' | 'stderr';
  data: string;             // raw text chunk (UTF-8); may be any size
}

// Emitted exactly once per cli.spawn id when the process terminates.
interface CliDoneParams {
  id: string;               // correlation id from cli.spawn
  exitCode: number;         // process exit code; 0 = success
  error?: string;           // set only when the process failed to start (e.g. binary not found)
}
```

Wire examples:

```json
{
  "jsonrpc": "2.0",
  "method": "cli.output",
  "params": {
    "id": "client-correlation-id",
    "stream": "stdout",
    "data": "chunk text"
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "method": "cli.done",
  "params": {
    "id": "client-correlation-id",
    "exitCode": 0,
    "error": ""
  }
}
```

- `cli.output.stream` is `stdout` or `stderr`.
- `cli.done` is sent once per `cli.spawn` id when the process exits.
- `cli.done.error` is present only when the process failed before a normal exit-code path.

## Error codes

| Code     | Name                   | When                                                        |
|----------|------------------------|-------------------------------------------------------------|
| `-32700` | ParseError             | Not JSON.                                                   |
| `-32600` | InvalidRequest         | JSON-RPC envelope is malformed.                             |
| `-32601` | MethodNotFound         | Unknown method.                                             |
| `-32602` | InvalidParams          | Params don't match the method's shape.                      |
| `-32603` | InternalError          | Unexpected server error.                                    |
| `-32000` | AuthRequired           | A non-`auth` method was called before auth succeeded.       |
| `-32001` | AuthInvalid            | `auth` called with a wrong token.                           |
| `-32010` | FileNotFound           | Path doesn't exist on the remote.                           |
| `-32011` | NotADirectory          | `fs.list` / `fs.rmdir` target is a file.                    |
| `-32012` | IsADirectory           | A file-only op targeted a directory.                        |
| `-32013` | Exists                 | Create-like op found the path already present.              |
| `-32014` | PermissionDenied       | OS rejected the operation (mode bits, quota, …).            |
| `-32015` | PathOutsideVault       | Resolved path escapes the vault root.                       |
| `-32020` | PreconditionFailed     | `expectedMtime` did not match the file's current mtime.     |
| `-32021` | ProtocolVersionTooOld  | `server.info` returned a version the client can't speak.    |

## Source of truth

- This document is normative for wire shape.
- `plugin/src/proto/types.ts` and `server/internal/proto/types.go`
  are hand-maintained mirrors. When the spec changes, both sides
  move in the same PR.
