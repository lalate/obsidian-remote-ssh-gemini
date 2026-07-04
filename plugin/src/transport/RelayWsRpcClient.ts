import { RpcError } from './RpcError';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  method: string;
}

/**
 * JSON-RPC 2.0 client over a browser WebSocket.
 *
 * Each text frame is one complete JSON-RPC message (no Content-Length
 * framing — unlike FramedDuplex / the SSH daemon path).
 *
 * Mirrors the subset of RpcClient that RpcRemoteFsClient uses so the
 * same adapter can be driven from either transport path.
 */
export class RelayWsRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly notificationHandlers = new Map<string, Array<(params: unknown) => void>>();
  private readonly closeHandlers: Array<(err?: Error) => void> = [];
  private closed = false;

  constructor(private readonly ws: WebSocket) {
    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      try { this.handleMessage(evt.data); } catch { /* ignore malformed */ }
    };
    ws.onclose = (evt) => {
      this.handleClose(
        evt.wasClean ? undefined : new Error(`WebSocket closed (code=${evt.code})`),
      );
    };
    ws.onerror = () => {
      this.handleClose(new Error('WebSocket error'));
    };
  }

  /**
   * Send a typed request and await its reply.
   * Rejects with an RpcError if the relay returned an error envelope,
   * or if the socket closed before the reply arrived.
   */
  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) throw new RpcError(-32603, 'RelayWsRpcClient: socket is closed');
    const id = this.nextId++;
    const request = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
      });
      try {
        this.ws.send(JSON.stringify(request));
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Register a handler for server-push notifications. Returns a disposer. */
  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const existing = this.notificationHandlers.get(method) ?? [];
    existing.push(handler);
    this.notificationHandlers.set(method, existing);
    return () => {
      const arr = this.notificationHandlers.get(method);
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  /** Register a close callback. Returns a disposer. */
  onClose(cb: (err?: Error) => void): () => void {
    this.closeHandlers.push(cb);
    return () => {
      const idx = this.closeHandlers.indexOf(cb);
      if (idx !== -1) this.closeHandlers.splice(idx, 1);
    };
  }

  isClosed(): boolean { return this.closed; }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
    this.handleClose(undefined);
  }

  /**
   * Send a JSON-RPC 2.0 notification (no `id`, no response expected).
   * Useful for keep-alive pings that should not accumulate pending
   * calls or produce errors on the wire.
   */
  notify(method: string, params: unknown): void {
    if (this.closed) return;
    const request = { jsonrpc: '2.0' as const, method, params };
    try {
      this.ws.send(JSON.stringify(request));
    } catch {
      // send failures surface through onclose; ignore here.
    }
  }

  /**
   * Start a lightweight keep-alive timer that periodically sends a
   * `system.ping` notification. The browser WebSocket API auto-responds
   * to server Ping frames, but this adds defense-in-depth for NAT /
   * proxy middleboxes that track application-level traffic.
   *
   * The timer stops automatically when the connection closes or when
   * the returned disposer is called.
   */
  startKeepAlive(intervalMs: number = 30_000): () => void {
    if (this.closed) return () => {};
    const id = setInterval(() => {
      if (this.closed) {
        clearInterval(id);
        return;
      }
      this.notify('system.ping', {});
    }, intervalMs);
    return () => clearInterval(id);
  }

  // ─── internal ──────────────────────────────────────────────────────────────

  private handleMessage(data: string): void {
    const msg = JSON.parse(data) as {
      jsonrpc?: string;
      id?: number;
      method?: string;
      result?: unknown;
      error?: { code: number; message: string };
      params?: unknown;
    };

    // Server-push notification (has method, no id)
    if (msg.method !== undefined && msg.id === undefined) {
      const handlers = this.notificationHandlers.get(msg.method) ?? [];
      for (const h of handlers) h(msg.params);
      return;
    }

    // Response (has id)
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new RpcError(msg.error.code, msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private handleClose(err?: Error): void {
    if (this.closed && !err) {
      // Already marked closed, just fire close handlers once.
      const handlers = [...this.closeHandlers];
      this.closeHandlers.length = 0;
      for (const h of handlers) h(err);
      return;
    }
    this.closed = true;
    const errToReport = err ?? new Error('RelayWsRpcClient: connection closed');
    for (const [, p] of this.pending) {
      p.reject(new RpcError(-32603, errToReport.message));
    }
    this.pending.clear();
    const handlers = [...this.closeHandlers];
    this.closeHandlers.length = 0;
    for (const h of handlers) h(err);
  }
}
