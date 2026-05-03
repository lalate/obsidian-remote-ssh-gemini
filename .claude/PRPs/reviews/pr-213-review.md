# PR Review: #213 — feat: Mobile対応 — WebSocketトランスポート基盤 + next/ 共通型定義

**Reviewed**: 2026-05-02
**Author**: sotashimozono
**Branch**: feat/mobile-relay-architecture → main
**Decision**: REQUEST CHANGES (1 HIGH — known WIP gap)

## Summary
Solid architecture for the mobile/relay transport layer — WsChannel framing is correct, MobileSecretStore fallback chain is sensible, next/ shared types are clean. One HIGH: mobile/src/index.ts re-exports files that don't exist yet, making the package unbuildable. Two MEDIUMs for latent correctness issues.

## Findings

### HIGH
**`mobile/src/index.ts:4-14` — Exports reference missing files**

`WsRpcClient.ts`, `WsRpcConnection.ts`, `WsRemoteFsClient.ts` are not in the commit. Building or importing `mobile/` will fail with module-not-found errors. Noted in PR description as known gap — but should be resolved (either commit stub implementations or remove the exports) before this merges to keep `main` buildable.

### MEDIUM
**`mobile/src/transport/WsChannel.ts:68` — Content-Length counts bytes, frame sent as text**

```ts
const text = new TextDecoder().decode(body);
const frame = `Content-Length: ${body.length}\r\n\r\n${text}`;
```
`body.length` is the Uint8Array byte count. `frame` is a JS string in a WebSocket text frame. If the relay or server counts Content-Length as UTF-16 code units (string `.length`), it will disagree for non-ASCII payloads. Document the encoding contract, or send as a binary WebSocket frame to avoid ambiguity.

### MEDIUM
**`mobile/src/platform/MobileSecretStore.ts:37` — LocalStorageSecretStore accessed when `window` is undefined**

`createMobileSecretStore()` checks `typeof window !== 'undefined'` before using Capacitor but falls back to `LocalStorageSecretStore` unconditionally. If `window` is undefined (SSR, Worker, test env) `LocalStorageSecretStore` will throw on first access. Guard with a `typeof localStorage !== 'undefined'` check or throw an explicit error.

### LOW
**`next/proto/types.ts:12-15` — `PROTOCOL_VERSION` and `RELAY_PROTOCOL_VERSION` are both `1`**

Both constants have value `1`. Future readers may conflate them or use the wrong one. Consider prefixed names (`DAEMON_PROTOCOL_VERSION`, `RELAY_PROTOCOL_VERSION`) to make the distinction clear even when values diverge.

## Validation Results
| Check | Result |
|---|---|
| Type check | Skipped |
| Lint | Skipped |
| Tests | Skipped |
| Build | Skipped (would fail — missing WsRpcClient.ts etc.) |

## Files Reviewed
- `mobile/src/transport/WsChannel.ts` — Added
- `mobile/src/transport/RpcError.ts` — Added
- `mobile/src/platform/MobileSecretStore.ts` — Added
- `mobile/src/index.ts` — Added
- `next/proto/types.ts` — Added
- `next/platform/SecretStore.ts` — Added
- `next/platform/PlatformAdapter.ts` — Added
- shared files (errorTaxonomy, HostKeyConfirmModal, fingerprint, obsidian.ts) — same as PR #212
