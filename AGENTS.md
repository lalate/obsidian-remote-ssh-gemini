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

### iOS Fork Branch Strategy (lalate/obsidian-remote-ssh-gemini)

```
feat/ios-ai-chat ─── feature source code (TypeScript, Go, tests)
     │
     │  rebase onto release/ios
     │
release/ios ──────── release artifacts only (plugin/main.js, manifest.json)
     │
     │  merged into main for upstream sync
     │
main ─────────────── stable releases
```

| Branch | What goes here | What does NOT go here |
|--------|---------------|----------------------|
| `feat/ios-ai-chat` | Source code (.ts, .go), tests, docs, scripts | Built binaries, compiled artifacts |
| `release/ios` | `plugin/main.js`, `plugin/manifest.json`, `plugin/versions.json` | Source code changes, test files |
| `main` | Stable releases via promotion from `next` | Feature work, pre-release builds |

**Workflow:**
1. Feature work commits to `feat/ios-ai-chat` (source + tests)
2. `feat/ios-ai-chat` is rebased onto `release/ios` to stay current
3. `release/ios` gets only built artifacts (main.js) after `node esbuild.ios.mjs production`
4. `release/ios` → GitHub Release → BRAT distribution

**Do NOT commit:**
- `server/obsidian-remote-server` — compiled Go binary (gitignored)
- `server/restart-daemon.sh` — local utility script
- `node_modules/`, `coverage/`, `dist/` — standard ignores

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

# iOS build (from plugin/)
node esbuild.ios.mjs production   # Build main.js for iOS (JSC, no dynamic import)

# iOS release (from plugin/)
./scripts/release-ios.sh          # Auto bump ios.NN, build, commit, push to release/ios
./scripts/release-ios.sh patch    # Same as above
./scripts/release-ios.sh 1.1.7-ios.0  # Explicit version

# Server (from server/)
make build                 # Build Go binary
make test                  # Go tests

# Docker test env
docker compose up -d       # Start test SSH daemon
```

## iOS RELEASE FLOW (fork: `lalate/obsidian-remote-ssh-gemini`)

```
release/ios  ───┬── plugin/manifest.json  ← version source of truth
                 ├── plugin/versions.json  ← minAppVersion compatibility map
                 ├── plugin/main.js        ← iOS build (esbuild.ios.mjs)
                 └── plugin/src/           ← TypeScript source
```

BRAT v1.1.0+ requires **GitHub Releases** — pushing to a branch alone is not
sufficient. BRAT fetches the plugin assets (`main.js`, `manifest.json`,
`styles.css`) from release assets, not from the branch.

The release tag, release name, and version in the released `manifest.json`
must all match (e.g. `1.1.6-ios.40`).

### Manual steps (or use `./scripts/release-ios.sh`):

1. Bump version in `plugin/manifest.json` (e.g. `1.1.6-ios.39` → `1.1.6-ios.40`)
2. Add entry to `plugin/versions.json`: `"1.1.6-ios.40": "1.5.0"`
3. Build iOS: `node esbuild.ios.mjs production`
4. Commit + tag + push:
   ```bash
   git add plugin/manifest.json plugin/versions.json plugin/main.js
   git commit -m "chore: bump version to 1.1.6-ios.40"
   git push origin release/ios
   git tag 1.1.6-ios.40
   git push origin 1.1.6-ios.40
   ```
5. Create GitHub Release:
   ```bash
   gh release create 1.1.6-ios.40 \
     --title "1.1.6-ios.40" \
     --notes "iOS release notes" \
     --target release/ios \
     plugin/main.js plugin/manifest.json plugin/styles.css
   ```

### Scripted version:

```bash
cd plugin && ./scripts/release-ios.sh
```

The script:
- Auto-increments `ios.NN`
- Updates `manifest.json` and `versions.json`
- Runs `esbuild.ios.mjs production`
- Verifies the build contains chat commands
- Commits and pushes to `release/ios`
- Creates git tag + GitHub Release with plugin assets (main.js, manifest.json, styles.css)

### Notes

- BRAT v1.1.0+ requires GitHub Releases. The old `manifest-beta.json`
  approach is deprecated and ignored by BRAT ≥ v1.1.0.
- iOS build uses `ios-entry.ts` (static imports) not `main.ts` (dynamic `import()`).
- Daemon binary lives at `~/.obsidian-remote/server` on the remote host; update separately.
- The remote daemon must also be updated (Go build + restart) for new server-side features.
- Root-level `main.js` / `manifest.json` are desktop builds; do NOT touch for iOS releases.
- `gh` (GitHub CLI) must be authenticated for release creation.

## NOTES

- Shadow vault window = separate Obsidian window with patched `app.vault.adapter`
- Two transports: `RPC` (recommended, Go daemon) and `SFTP` (direct ssh2, no daemon)
- Mobile WebSocket relay bridges mobile clients through a relay server
- AI Chat: server writes response via opencode CLI; plugin polls vault file (1.5s)
- Plugin dynamically discovers LLM tool config via `chat.status` RPC (`ChatToolStatus`)

## ACTIVE DECISIONS

See `.omo/decisions/` for full context.

| # | Decision | Status | Phase |
|---|----------|--------|-------|
| 001 | AI Chat architecture — layer separation | **Decided** | v1 active, v2/v3 planned |

Current v1 work: streaming + model/agent selection UI + server.update RPC + iOS release script.
Next (v2): provider_info RPC for provider-specific metadata, codebase path config.
