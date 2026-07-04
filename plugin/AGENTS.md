# Obsidian Remote SSH Plugin

## OVERVIEW

TypeScript Obsidian plugin providing VS Code Remote-SSH-style experience for connecting to remote vaults over SSH.

## STRUCTURE

```
plugin/src/
├── shadow/      # Shadow vault window management, spawning, registry
├── adapter/     # RPC/SFTP remote filesystem clients, adapter patching
├── transport/   # JSON-RPC framing, WebSocket connections
├── ssh/         # SSH authentication, config parsing, key handling
├── conflict/    # 3-way merge, offline queue, conflict resolution
├── ui/          # Modals, status bar, terminal view components
├── vault/       # Vault abstraction, state management
├── settings/    # Plugin settings, configuration UI
├── cache/       # File caching, metadata storage
├── offline/     # Offline mode, queue persistence
├── path/        # Path normalization, vault path handling
├── proto/       # Protobuf definitions, serialization
└── util/        # Shared utilities, helpers
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Connect & spawn window | `src/shadow/ShadowVaultManager.ts`, `Bootstrap.ts` |
| RPC protocol | `src/transport/RpcClient.ts`, `src/adapter/RpcRemoteFsClient.ts` |
| SSH auth | `src/ssh/AuthResolver.ts`, `SshConfigReader.ts` |
| Conflict resolution | `src/conflict/` 3-way merge, `OfflineQueue.ts` |
| UI components | `src/ui/` Modal components, status bar |
| Settings | `src/settings/SettingsTab.ts` |

## CONVENTIONS

- TypeScript strict mode, ES modules (`"type": "module"`)
- vitest for unit tests, Playwright for E2E
- esbuild for production bundling
- Unix socket for RPC daemon communication

## ANTI-PATTERNS

- No `any` type - strict mode enforced
- No raw `fs` calls - use `app.vault.adapter`
- No committing `main.js`, `node_modules/`, coverage, perf results

## COMMANDS

```bash
npm run build        # Production build
npm run test         # Unit tests (vitest)
npm run test:integration  # Docker SSH daemon required
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
```