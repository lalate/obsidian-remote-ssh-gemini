# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-01
**Branch:** next
**Commit:** b7099d1

## OVERVIEW

Obsidian Remote SSH — VS Code Remote-SSH-style experience for Obsidian. Opens a remote vault over SSH in a separate Obsidian window. Core stack: TypeScript (Obsidian plugin) + Go (RPC daemon) + WebSocket (iOS/Android mobile transport).

## STRUCTURE

```
obsidian-remote-ssh/
├── plugin/          # Obsidian plugin: core FS client, SSH/transport, UI, conflict resolution
├── server/          # Go daemon (obsidian-remote-server): JSON-RPC over unix socket
├── mobile/          # iOS/Android WebSocket transport layer
├── docs/            # Documentation (architecture, user-guide, cookbook)
├── docs-site/       # Quartz documentation site (separate build)
├── next/            # Shared TypeScript types/interfaces
├── proto/           # Protobuf definitions
├── deploy/          # Deployment manifests
├── docker/          # Docker test environment
├── scripts/         # Build/release/dev utility scripts
└── reference/       # Reference materials
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Connect to remote & spawn window | `plugin/src/shadow/` | ShadowVaultManager → Bootstrap → Registry → WindowSpawner |
| FS operations over SSH | `plugin/src/adapter/` | RpcRemoteFsClient, SftpRemoteFsClient, AdapterPatcher |
| RPC wire protocol | `plugin/src/transport/` + `server/internal/rpc/` | Framed JSON-RPC |
| SSH authentication | `plugin/src/ssh/` | AuthResolver, SshConfigReader, SshKeyGen |
| Conflict resolution | `plugin/src/conflict/` | 3-way merge, offline queue |
| UI components | `plugin/src/ui/` | Modals, status bar, terminal view |
| Go daemon handlers | `server/internal/handlers/` | fs_read, fs_write, fs_watch, fs_walk, etc. |
| Mobile transport (iOS/Android) | `mobile/src/` | WebSocket relay, WsRpcClient |
| Documentation | `docs/en/` | Architecture decisions, user guides |
| Integration tests | `plugin/tests/integration/` | SSH-based multi-client tests |
| E2E tests | `plugin/e2e/` | Playwright test suite |

## CONVENTIONS

- **Branch**: `next` = integration, `main` = stable releases
- **Commits**: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`)
- **TypeScript**: strict mode, ES modules (`"type": "module"`)
- **Go**: standard lib + minimal dependencies, go 1.25+
- **Testing**: vitest (unit), Playwright (e2e), Docker test SSH daemon
- **Versioning**: `npm version prerelease --preid=beta`, manifests in `plugin/`
- **Daemon signing**: Sigstore cosign keyless OIDC for release binaries

## ANTI-PATTERNS (THIS PROJECT)

- Do NOT use `any` type in TypeScript — strict mode enforced
- Do NOT bypass `app.vault.adapter` — plugins using raw `fs` won't see remote vault
- Do NOT commit `node_modules/`, `main.js`, coverage, perf results, or e2e artifacts
- Do NOT force-push to `main` — stable releases via promotion PRs only
- Do NOT skip `go.mod` / `go.sum` hygiene — CI fails on mismatch

## COMMANDS

```bash
# Plugin (from plugin/)
npm run build              # Production build via esbuild
npm run test               # Unit tests (vitest)
npm run test:integration   # Integration tests (Docker SSH daemon required)
npm run test:e2e           # Playwright E2E tests
npm run lint               # ESLint

# Server (from server/)
make build                 # Build Go binary
make test                  # Run Go tests

# Docker test env
docker compose up -d       # Start test SSH daemon
```

## NOTES

- Shadow vault window = separate Obsidian window with patched `app.vault.adapter`
- Two transports: `RPC` (recommended, Go daemon) and `SFTP` (direct ssh2, no daemon)
- Mobile WebSocket relay bridges mobile clients through a relay server
- The user wants to build AI conversation via shared text file on iOS Obsidian — this would extend the mobile transport layer
