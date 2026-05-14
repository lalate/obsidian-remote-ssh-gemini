import { WsChannel } from './WsChannel.js';
import { WsRpcClient } from './WsRpcClient.js';
import { RpcError } from './RpcError.js';
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
export class WsRpcConnection {
    constructor(rpc, serverInfo) {
        this.rpc = rpc;
        this.serverInfo = serverInfo;
    }
    /** Tear down the underlying WebSocket channel. */
    close() {
        this.rpc.close();
    }
    /**
     * Open a WsChannel over `ws`, authenticate with `token`, and fetch
     * server info. Resolves once the handshake completes; rejects with
     * RpcError if auth is refused or the connection drops.
     *
     * The WsChannel is created internally so callers pass a raw
     * WebSocket — they do not need to construct WsChannel themselves.
     */
    static async connect(ws, opts) {
        const channel = new WsChannel(ws, { queueBeforeOpen: true });
        const rpc = new WsRpcClient(channel, { timeoutMs: opts.timeoutMs });
        // Wait for the WebSocket to open before sending any frames.
        await waitForOpen(ws);
        // 1. Authenticate.
        await rpc.call('auth', { token: opts.token });
        // 2. Fetch server capabilities and vault root.
        const info = await rpc.call('server.info', {});
        return new WsRpcConnection(rpc, info);
    }
}
// ─── helpers ─────────────────────────────────────────────────────────────────
function waitForOpen(ws) {
    if (ws.readyState === WebSocket.OPEN)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        const onOpen = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new RpcError(-32603, 'WebSocket failed to open')); };
        const onClose = () => { cleanup(); reject(new RpcError(-32603, 'WebSocket closed before open')); };
        function cleanup() {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onClose);
        }
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);
    });
}
//# sourceMappingURL=WsRpcConnection.js.map