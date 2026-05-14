/**
 * Mirrors plugin/src/transport/RpcError.ts without any Node.js imports.
 */
export class RpcError extends Error {
    constructor(code, message, data) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.data = data;
    }
}
//# sourceMappingURL=RpcError.js.map