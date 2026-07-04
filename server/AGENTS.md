# AGENTS.md for server/ (Go RPC daemon)

## OVERVIEW

Go RPC daemon (`obsidian-remote-server`) that listens on a unix socket for framed JSON-RPC requests from the Obsidian plugin client.

## STRUCTURE

```
server/
├── cmd/obsidian-remote-server/    # Main entry point, flag parsing, daemon startup
├── internal/handlers/              # RPC method handlers (fs_*, auth, extension, working_dir)
├── internal/rpc/                   # Framed JSON-RPC transport, dispatcher, framing
├── internal/server/                # Unix socket server, session management
├── internal/auth/                  # Token validation, auth middleware
├── internal/watcher/               # fsnotify-based file change detection
├── internal/vaultfs/               # Vault path resolution, relative path handling
└── internal/proto/                 # Shared types, request/response structs
```

## WHERE TO LOOK

| RPC Method | Handler File(s) |
|------------|-----------------|
| fs_read | `handlers/fs_read_text.go`, `handlers/fs_read_binary.go` |
| fs_write | `handlers/fs_write.go`, `handlers/fs_write_binary.go` |
| fs_append | `handlers/fs_append.go`, `handlers/fs_append_binary.go` |
| fs_walk | `handlers/fs_walk.go` |
| fs_list | `handlers/fs_list.go` |
| fs_watch | `handlers/fs_watch.go` |
| fs_unwatch | `handlers/fs_unwatch.go` |
| fs_stat | `handlers/fs_stat.go` |
| fs_exists | `handlers/fs_exists.go` |
| fs_mkdir | `handlers/fs_mkdir.go` |
| fs_remove | `handlers/fs_remove.go` |
| fs_rmdir | `handlers/fs_rmdir.go` |
| fs_rename | `handlers/fs_rename.go` |
| fs_copy | `handlers/fs_copy.go` |
| fs_thumbnail | `handlers/fs_thumbnail.go` |
| fs_trash_local | `handlers/fs_trash_local.go` |
| auth | `handlers/auth.go` |
| extension | `handlers/extension.go` |
| working_dir | `handlers/working_dir.go` |
| server_info | `handlers/server_info.go` |

## CONVENTIONS

- Go 1.25+, standard library + minimal deps (fsnotify, gorilla/websocket, golang.org/x/image)
- `gofumpt` formatting, table-driven tests
- Handler pattern: `func(ctx context.Context, req *Request) (*Response, error)`
- Errors returned as `*rpc.Error` with code/message
- Context carries session ID via `ctx.Value(sessionKey)`

## ANTI-PATTERNS

- No unused dependencies (run `go mod tidy` before commit)
- No panic recovery at handler level (let it crash, supervisor restarts)
- No `any` type (strict typing)
- No direct os calls outside vaultfs path resolution

## COMMANDS

```bash
make build    # Build obsidian-remote-server binary
make test     # Run all tests
make lint     # Run golangci-lint
```