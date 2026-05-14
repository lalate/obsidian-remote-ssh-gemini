export class WsChannel {
    constructor(ws, options = {}) {
        this.queue = [];
        this.messageHandlers = [];
        this.closeHandlers = [];
        this._closed = false;
        this.ws = ws;
        this.maxMessageBytes = options.maxMessageBytes ?? 16 * 1024 * 1024;
        const queueBeforeOpen = options.queueBeforeOpen ?? false;
        ws.addEventListener('open', () => {
            if (queueBeforeOpen) {
                for (const frame of this.queue) {
                    ws.send(frame);
                }
                this.queue.length = 0;
            }
        });
        ws.addEventListener('message', (ev) => {
            if (typeof ev.data !== 'string')
                return;
            const body = this.parseFrame(ev.data);
            if (body === null)
                return;
            for (const h of [...this.messageHandlers]) {
                try {
                    h(body);
                }
                catch { /* per-handler isolation */ }
            }
        });
        ws.addEventListener('close', (ev) => {
            this._closed = true;
            for (const h of [...this.closeHandlers]) {
                try {
                    h(ev);
                }
                catch { /* ignore */ }
            }
        });
    }
    /** Send one framed message. Queues if the socket is connecting and queueBeforeOpen is true. */
    send(body) {
        if (this._closed)
            throw new Error('WsChannel: closed');
        const text = new TextDecoder().decode(body);
        const frame = `Content-Length: ${body.length}\r\n\r\n${text}`;
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(frame);
        }
        else if (this.ws.readyState === WebSocket.CONNECTING) {
            this.queue.push(frame);
        }
        else {
            throw new Error('WsChannel: socket is not open or connecting');
        }
    }
    /** Register a handler for inbound messages. Returns a disposer. */
    onMessage(cb) {
        this.messageHandlers.push(cb);
        return () => {
            const i = this.messageHandlers.indexOf(cb);
            if (i >= 0)
                this.messageHandlers.splice(i, 1);
        };
    }
    /** Register a handler for socket close events. Returns a disposer. */
    onClose(cb) {
        this.closeHandlers.push(cb);
        return () => {
            const i = this.closeHandlers.indexOf(cb);
            if (i >= 0)
                this.closeHandlers.splice(i, 1);
        };
    }
    close() {
        if (this._closed)
            return;
        this._closed = true;
        try {
            this.ws.close();
        }
        catch { /* ignore */ }
    }
    get readyState() {
        return this.ws.readyState;
    }
    // ─── parser ──────────────────────────────────────────────────────────────────
    parseFrame(frame) {
        const rnrn = frame.indexOf('\r\n\r\n');
        const nn = frame.indexOf('\n\n');
        let headerEnd;
        let bodyStart;
        if (rnrn !== -1 && (nn === -1 || rnrn <= nn)) {
            headerEnd = rnrn;
            bodyStart = rnrn + 4;
        }
        else if (nn !== -1) {
            headerEnd = nn;
            bodyStart = nn + 2;
        }
        else {
            return null;
        }
        const headers = frame.slice(0, headerEnd);
        const contentLength = parseContentLength(headers);
        if (contentLength === null || contentLength > this.maxMessageBytes)
            return null;
        const bodyText = frame.slice(bodyStart);
        return new TextEncoder().encode(bodyText);
    }
}
function parseContentLength(headers) {
    for (const line of headers.split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon < 0)
            continue;
        if (line.slice(0, colon).trim().toLowerCase() === 'content-length') {
            const n = parseInt(line.slice(colon + 1).trim(), 10);
            if (Number.isFinite(n) && n >= 0)
                return n;
        }
    }
    return null;
}
//# sourceMappingURL=WsChannel.js.map