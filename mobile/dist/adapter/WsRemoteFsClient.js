/**
 * WsRemoteFsClient speaks to the Go daemon via WsRpcClient over a
 * browser WebSocket + relay. It mirrors RpcRemoteFsClient (desktop)
 * but uses Uint8Array / base64 instead of Node.js Buffer.
 */
export class WsRemoteFsClient {
    constructor(rpc) {
        this.rpc = rpc;
    }
    // ─── lifecycle ─────────────────────────────────────────────────────────
    isAlive() {
        return !this.rpc.isClosed();
    }
    onClose(cb) {
        return this.rpc.onClose((err) => cb({ unexpected: err !== undefined }));
    }
    // ─── read side ─────────────────────────────────────────────────────────
    async stat(path) {
        const s = await this.rpc.call('fs.stat', { path });
        if (s === null) {
            throw Object.assign(new Error(`no such file: ${path}`), { code: -32020 });
        }
        return toRemoteStat(s);
    }
    async exists(path) {
        const r = await this.rpc.call('fs.exists', { path });
        return r.exists;
    }
    async list(path) {
        const r = await this.rpc.call('fs.list', { path });
        return r.entries.map(toRemoteEntry);
    }
    async readBinary(path) {
        const r = await this.rpc.call('fs.readBinary', { path });
        return b64ToUint8Array(r.contentBase64);
    }
    async readBinaryRange(path, offset, length, expectedMtime) {
        const r = await this.rpc.call('fs.readBinaryRange', {
            path, offset, length,
            ...(expectedMtime !== undefined ? { expectedMtime } : {}),
        });
        return { data: b64ToUint8Array(r.contentBase64), mtime: r.mtime, size: r.size };
    }
    // ─── write side ────────────────────────────────────────────────────────
    async writeBinary(path, data, expectedMtime) {
        await this.rpc.call('fs.writeBinary', {
            path,
            contentBase64: uint8ArrayToB64(data),
            ...(expectedMtime !== undefined ? { expectedMtime } : {}),
        });
    }
    async mkdirp(path) {
        await this.rpc.call('fs.mkdir', { path, recursive: true });
    }
    async remove(path) {
        await this.rpc.call('fs.remove', { path });
    }
    async rmdir(path, recursive = false) {
        await this.rpc.call('fs.rmdir', { path, recursive });
    }
    async rename(oldPath, newPath) {
        await this.rpc.call('fs.rename', { oldPath, newPath });
    }
    async copy(srcPath, destPath) {
        await this.rpc.call('fs.copy', { srcPath, destPath });
    }
}
// ─── DTO converters ──────────────────────────────────────────────────────────
function toRemoteStat(s) {
    return {
        isDirectory: s.type === 'folder',
        isFile: s.type === 'file',
        isSymbolicLink: false,
        mtime: s.mtime,
        size: s.size,
        mode: s.mode,
    };
}
function toRemoteEntry(e) {
    return {
        name: e.name,
        isDirectory: e.type === 'folder',
        isFile: e.type === 'file',
        isSymbolicLink: e.type === 'symlink',
        mtime: e.mtime,
        size: e.size,
    };
}
// ─── base64 helpers ──────────────────────────────────────────────────────────
function uint8ArrayToB64(data) {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}
function b64ToUint8Array(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}
//# sourceMappingURL=WsRemoteFsClient.js.map