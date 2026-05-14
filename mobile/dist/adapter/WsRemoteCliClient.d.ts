import { WsRpcClient } from '../transport/WsRpcClient.js';
export interface CliExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export interface CliSpawnResult {
    ok: boolean;
}
export interface CliOutputParams {
    id: string;
    stream: 'stdout' | 'stderr';
    data: string;
    seq: number;
}
export interface CliOutputBatchParams {
    chunks: CliOutputParams[];
}
export interface CliDoneParams {
    id: string;
    exitCode: number;
    error?: string;
}
/**
 * Thin CLI RPC facade for the mobile transport layer.
 */
export declare class WsRemoteCliClient {
    private readonly rpc;
    constructor(rpc: WsRpcClient);
    exec(cmd: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<CliExecResult>;
    spawn(id: string, cmd: string, args: string[], cwd?: string, env?: Record<string, string>, persist?: boolean, resumeFrom?: number): Promise<CliSpawnResult>;
    kill(id: string): Promise<void>;
    onOutput(handler: (params: CliOutputParams) => void): () => void;
    onOutputBatch(handler: (params: CliOutputBatchParams) => void): () => void;
    onDone(handler: (params: CliDoneParams) => void): () => void;
}
//# sourceMappingURL=WsRemoteCliClient.d.ts.map