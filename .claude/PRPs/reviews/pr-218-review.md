# PR Review: #218 — feat(mobile): implement WsRpcClient / WsRpcConnection / WsRemoteFsClient

**Reviewed**: 2026-05-02
**Author**: sotashimozono
**Branch**: feat/mobile-ws-rpc-client → main
**Decision**: APPROVE (with comments)

## Summary
Clean, well-structured implementation of the three missing mobile transport files. Logic is correct, tests are thorough (24 passing), and no Node.js dependencies leak in. Three medium issues to address.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

**M1 — `stat()` throws plain `Error` instead of `RpcError` (`WsRemoteFsClient.ts:78`)**
```ts
throw Object.assign(new Error(`no such file: ${path}`), { code: -32020 });
```
Callers doing `catch (e) { if (e instanceof RpcError) ... }` will miss this. Should use `RpcError` directly:
```ts
import { RpcError } from '../transport/RpcError.js';
throw new RpcError(-32020, `no such file: ${path}`);
```

**M2 — `uint8ArrayToB64` is O(n²) for large payloads (`WsRemoteFsClient.ts:155`)**
```ts
for (let i = 0; i < data.length; i++) {
  binary += String.fromCharCode(data[i]);  // quadratic string concat
}
```
For 1 MB+ files this creates millions of intermediate strings. Fix with chunked spread:
```ts
const CHUNK = 0x8000;
let binary = '';
for (let i = 0; i < data.length; i += CHUNK) {
  binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
}
return btoa(binary);
```

**M3 — `waitForOpen` doesn't handle `CLOSING`/`CLOSED` states (`WsRpcConnection.ts:67`)**
If `ws.readyState` is `CLOSING` (2) or `CLOSED` (3), the function registers listeners but `open` will never fire and the promise hangs until the 30 s RPC timeout. Fix:
```ts
if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
  return Promise.reject(new RpcError(-32603, 'WebSocket is already closing or closed'));
}
```

### LOW

**L1 — `beforeEach` imported but unused (`WsRpcClient.test.ts:1`)**
Remove `beforeEach` from the vitest import.

**L2 — `onClose()` disposer not tested**
`onNotification` disposer is tested; `onClose` disposer is not. Minor coverage gap.

## Validation Results

| Check | Result |
|---|---|
| TypeScript (tsc --noEmit) | Pass |
| Tests (vitest run) | Pass (24/24) |
| Build | Skipped |

## Files Reviewed
- `mobile/src/transport/WsRpcClient.ts` — Added
- `mobile/src/transport/WsRpcConnection.ts` — Added
- `mobile/src/adapter/WsRemoteFsClient.ts` — Added
- `mobile/src/index.ts` — Modified
- `mobile/tests/WsRpcClient.test.ts` — Added
- `mobile/tests/WsRpcConnection.test.ts` — Added
- `mobile/tests/WsRemoteFsClient.test.ts` — Added
- `mobile/package-lock.json` — Added
