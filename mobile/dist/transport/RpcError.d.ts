/**
 * Mirrors plugin/src/transport/RpcError.ts without any Node.js imports.
 */
export declare class RpcError extends Error {
    readonly code: number;
    readonly data?: unknown;
    constructor(code: number, message: string, data?: unknown);
}
//# sourceMappingURL=RpcError.d.ts.map