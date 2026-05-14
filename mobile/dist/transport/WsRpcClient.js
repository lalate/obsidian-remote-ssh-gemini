import { RpcError } from './RpcError.js';
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
export class WsRpcClient {
    constructor(channel, opts = {}) {
        this.channel = channel;
        this.nextId = 1;
        this.pending = new Map();
        this.notificationHandlers = new Map();
        this.closeHandlers = [];
        this.closed = false;
        this.timeoutMs = opts.timeoutMs ?? 30000;
        channel.onMessage((body) => this.handleMessage(body));
        channel.onClose(() => this.handleClose());
    }
    /** Send a request and await its reply. Rejects with RpcError on daemon error or timeout. */
    async call(method, params) {
        if (this.closed)
            throw new RpcError(-32603, 'WsRpcClient: closed');
        const id = this.nextId++;
        const body = new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new RpcError(-32603, `RPC timeout: ${method}`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.channel.send(body);
            }
            catch (e) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }
    /** Register a handler for server-push notifications. Returns a disposer. */
    onNotification(method, handler) {
        const list = this.notificationHandlers.get(method) ?? [];
        list.push(handler);
        this.notificationHandlers.set(method, list);
        return () => {
            const l = this.notificationHandlers.get(method);
            if (!l)
                return;
            const i = l.indexOf(handler);
            if (i >= 0)
                l.splice(i, 1);
        };
    }
    /** Called once when the channel closes (cleanly or with error). Returns a disposer. */
    onClose(handler) {
        this.closeHandlers.push(handler);
        return () => {
            const i = this.closeHandlers.indexOf(handler);
            if (i >= 0)
                this.closeHandlers.splice(i, 1);
        };
    }
    isClosed() { return this.closed; }
    /** Close the underlying channel; pending calls reject. */
    close() {
        if (this.closed)
            return;
        this.channel.close();
    }
    // ─── internals ────────────────────────────────────────────────────────────
    handleMessage(body) {
        let msg;
        try {
            msg = JSON.parse(new TextDecoder().decode(body));
        }
        catch {
            return; // ignore malformed frames
        }
        if (typeof msg !== 'object' || msg === null)
            return;
        const m = msg;
        // Response — matches a pending call by numeric id.
        if (typeof m['id'] === 'number') {
            const p = this.pending.get(m['id']);
            if (!p)
                return;
            clearTimeout(p.timer);
            this.pending.delete(m['id']);
            const err = m['error'];
            if (err && typeof err === 'object') {
                const e = err;
                p.reject(new RpcError(e.code, e.message, e.data));
                return;
            }
            p.resolve('result' in m ? m['result'] : null);
            return;
        }
        // Notification — no id.
        if (typeof m['method'] === 'string') {
            const list = this.notificationHandlers.get(m['method']);
            if (!list || list.length === 0)
                return;
            const params = m['params'];
            for (const h of [...list]) {
                try {
                    h(params);
                }
                catch { /* per-handler isolation */ }
            }
        }
    }
    handleClose(err) {
        if (this.closed)
            return;
        this.closed = true;
        const reason = err ?? new RpcError(-32603, 'WsRpcClient: stream closed before reply');
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(reason);
        }
        this.pending.clear();
        for (const cb of [...this.closeHandlers]) {
            try {
                cb(err);
            }
            catch { /* ignore */ }
        }
    }
}
//# sourceMappingURL=WsRpcClient.js.map