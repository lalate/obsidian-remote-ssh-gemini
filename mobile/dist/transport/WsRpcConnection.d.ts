import { WsRpcClient } from './WsRpcClient.js';
/** Minimal ServerInfo shape (mirrors next/proto/types.ts). */
export interface ServerInfo {
    version: string;
    protocolVersion: number;
    capabilities: string[];
    vaultRoot: string;
}
export interface WsRpcConnectionOptions {
    /** Auth token issued by the relay / plugin on the other end. */
    token: string;
    /** Call timeout forwarded to WsRpcClient. Default 30 000 ms. */
    timeoutMs?: number;
}
/**
 * A successfully authenticated JSON-RPC connection to the remote
 * daemon (or relay). Exposes the underlying RPC client + the
 * server info gathered during the handshake.
 *
 * Typical lifecycle:
 *
 *   const conn = await WsRpcConnection.connect(ws, { token });
 *   const client = conn.rpc;
 *   conn.close(); // tears down the WsChannel
 */
export declare class WsRpcConnection {
    /** The authenticated RPC client. Use this for all subsequent calls. */
    readonly rpc: WsRpcClient;
    /** Info returned by the server.info RPC during the handshake. */
    readonly serverInfo: ServerInfo;
    private constructor();
    /** Tear down the underlying WebSocket channel. */
    close(): void;
    /**
     * Open a WsChannel over `ws`, authenticate with `token`, and fetch
     * server info. Resolves once the handshake completes; rejects with
     * RpcError if auth is refused or the connection drops.
     *
     * The WsChannel is created internally so callers pass a raw
     * WebSocket — they do not need to construct WsChannel themselves.
     */
    static connect(ws: WebSocket, opts: WsRpcConnectionOptions): Promise<WsRpcConnection>;
}
//# sourceMappingURL=WsRpcConnection.d.ts.map