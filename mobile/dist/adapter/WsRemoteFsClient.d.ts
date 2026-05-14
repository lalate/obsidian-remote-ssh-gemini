import { WsRpcClient } from '../transport/WsRpcClient.js';
export interface RemoteStat {
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
    mtime: number;
    size: number;
    mode: number;
}
export interface RemoteEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
    mtime: number;
    size: number;
}
export type CloseListener = (event: {
    unexpected: boolean;
}) => void;
/**
 * WsRemoteFsClient speaks to the Go daemon via WsRpcClient over a
 * browser WebSocket + relay. It mirrors RpcRemoteFsClient (desktop)
 * but uses Uint8Array / base64 instead of Node.js Buffer.
 */
export declare class WsRemoteFsClient {
    private readonly rpc;
    constructor(rpc: WsRpcClient);
    isAlive(): boolean;
    onClose(cb: CloseListener): () => void;
    stat(path: string): Promise<RemoteStat>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<RemoteEntry[]>;
    readBinary(path: string): Promise<Uint8Array>;
    readBinaryRange(path: string, offset: number, length: number, expectedMtime?: number): Promise<{
        data: Uint8Array;
        mtime: number;
        size: number;
    }>;
    writeBinary(path: string, data: Uint8Array, expectedMtime?: number): Promise<void>;
    mkdirp(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    rmdir(path: string, recursive?: boolean): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copy(srcPath: string, destPath: string): Promise<void>;
}
//# sourceMappingURL=WsRemoteFsClient.d.ts.map