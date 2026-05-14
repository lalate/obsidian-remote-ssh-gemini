import { WsChannel } from './WsChannel.js';
export type MethodName = 'auth' | 'server.info' | 'fs.stat' | 'fs.exists' | 'fs.list' | 'fs.walk' | 'fs.readText' | 'fs.readBinary' | 'fs.readBinaryRange' | 'fs.thumbnail' | 'fs.write' | 'fs.writeBinary' | 'fs.append' | 'fs.appendBinary' | 'fs.mkdir' | 'fs.remove' | 'fs.rmdir' | 'fs.rename' | 'fs.copy' | 'fs.watch' | 'fs.unwatch' | 'cli.exec' | 'cli.spawn' | 'cli.kill';
export interface WsRpcClientOptions {
    /** Call timeout in milliseconds. Default 30 000. */
    timeoutMs?: number;
}
/**
 * Correlates JSON-RPC 2.0 calls over a WsChannel.
 *
 * Each call() writes a Request with a fresh numeric id and returns a
 * Promise that resolves with the decoded `result` when the matching
 * reply arrives, or rejects with RpcError when the daemon returns an
 * error envelope or the call times out.
 *
 * Server-push notifications are delivered to handlers registered via
 * onNotification(). When the channel closes, every pending call is
 * rejected so callers do not hang forever.
 */
export declare class WsRpcClient {
    private readonly channel;
    private nextId;
    private readonly pending;
    private readonly notificationHandlers;
    private readonly closeHandlers;
    private closed;
    private readonly timeoutMs;
    constructor(channel: WsChannel, opts?: WsRpcClientOptions);
    /** Send a request and await its reply. Rejects with RpcError on daemon error or timeout. */
    call(method: MethodName, params: Record<string, unknown>): Promise<unknown>;
    /** Register a handler for server-push notifications. Returns a disposer. */
    onNotification(method: string, handler: (params: unknown) => void): () => void;
    /** Called once when the channel closes (cleanly or with error). Returns a disposer. */
    onClose(handler: (err?: Error) => void): () => void;
    isClosed(): boolean;
    /** Close the underlying channel; pending calls reject. */
    close(): void;
    private handleMessage;
    private handleClose;
}
//# sourceMappingURL=WsRpcClient.d.ts.map