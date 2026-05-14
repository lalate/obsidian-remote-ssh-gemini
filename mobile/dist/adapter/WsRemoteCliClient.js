/**
 * Thin CLI RPC facade for the mobile transport layer.
 */
export class WsRemoteCliClient {
    constructor(rpc) {
        this.rpc = rpc;
    }
    async exec(cmd, args, cwd, env) {
        return this.rpc.call('cli.exec', {
            cmd,
            args,
            ...(cwd !== undefined ? { cwd } : {}),
            ...(env !== undefined ? { env } : {}),
        });
    }
    async spawn(id, cmd, args, cwd, env, persist, resumeFrom) {
        return this.rpc.call('cli.spawn', {
            id,
            cmd,
            args,
            ...(cwd !== undefined ? { cwd } : {}),
            ...(env !== undefined ? { env } : {}),
            ...(persist !== undefined ? { persist } : {}),
            ...(resumeFrom !== undefined ? { resumeFrom } : {}),
        });
    }
    async kill(id) {
        await this.rpc.call('cli.kill', { id });
    }
    onOutput(handler) {
        return this.rpc.onNotification('cli.output', (params) => handler(params));
    }
    onOutputBatch(handler) {
        return this.rpc.onNotification('cli.output.batch', (params) => handler(params));
    }
    onDone(handler) {
        return this.rpc.onNotification('cli.done', (params) => handler(params));
    }
}
//# sourceMappingURL=WsRemoteCliClient.js.map