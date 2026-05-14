/**
 * WsChannel wraps a browser-standard WebSocket and provides the same
 * send/receive contract as FramedDuplex on Desktop — but without any
 * Node.js dependencies.
 *
 * Framing protocol (identical to what the Go daemon expects):
 *
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <N bytes of UTF-8 JSON body>
 *
 * Each framed message is sent as a single WebSocket text frame so the
 * relay can forward it verbatim without buffering partial frames.
 *
 * Messages received before the socket is open are queued and flushed
 * once the connection is established (opt-in via `queueBeforeOpen`).
 */
export interface WsChannelOptions {
    /** If true, calls to send() before OPEN are queued rather than throwing. Default false. */
    queueBeforeOpen?: boolean;
    /** Maximum allowed body size in bytes. Default 16 MiB. */
    maxMessageBytes?: number;
}
export declare class WsChannel {
    private readonly ws;
    private readonly maxMessageBytes;
    private readonly queue;
    private readonly messageHandlers;
    private readonly closeHandlers;
    private _closed;
    constructor(ws: WebSocket, options?: WsChannelOptions);
    /** Send one framed message. Queues if the socket is connecting and queueBeforeOpen is true. */
    send(body: Uint8Array): void;
    /** Register a handler for inbound messages. Returns a disposer. */
    onMessage(cb: (body: Uint8Array) => void): () => void;
    /** Register a handler for socket close events. Returns a disposer. */
    onClose(cb: (ev: CloseEvent) => void): () => void;
    close(): void;
    get readyState(): number;
    private parseFrame;
}
//# sourceMappingURL=WsChannel.d.ts.map