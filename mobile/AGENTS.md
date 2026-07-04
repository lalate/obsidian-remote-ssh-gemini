# Mobile Transport Layer (mobile/)

## OVERVIEW

WebSocket transport layer bridging mobile Obsidian clients (iOS/Android) to the remote SSH daemon via a relay server.

## STRUCTURE

```
mobile/src/
├── transport/    # WsChannel, WsRpcClient, WsRpcConnection, RpcError
├── adapter/      # WsRemoteFsClient — FS operations over WebSocket
└── platform/     # MobileSecretStore — platform-specific secret storage
```

## WHERE TO LOOK

| Task | File |
|------|------|
| RPC over WebSocket | `src/transport/WsRpcClient.ts` |
| Connection lifecycle | `src/transport/WsRpcConnection.ts` |
| WebSocket channel | `src/transport/WsChannel.ts` |
| FS operations | `src/adapter/WsRemoteFsClient.ts` |
| Secret storage | `src/platform/MobileSecretStore.ts` |

## CONVENTIONS

- TypeScript strict mode, ES modules
- vitest for unit tests
- Same RPC protocol as desktop plugin (framed JSON-RPC), tunneled over WebSocket

## ANTI-PATTERNS

- No direct SSH connections from mobile (must go through WebSocket relay)
- No raw `fs` access — use WsRemoteFsClient

## COMMANDS

```bash
npm run build    # TypeScript compile
npm run test     # Run unit tests
```