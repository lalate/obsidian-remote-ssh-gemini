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
}

export interface CliDoneParams {
  id: string;
  exitCode: number;
  error?: string;
}

/**
 * Thin CLI RPC facade for the mobile transport layer.
 */
export class WsRemoteCliClient {
  constructor(private readonly rpc: WsRpcClient) {}

  async exec(
    cmd: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<CliExecResult> {
    return this.rpc.call('cli.exec', {
      cmd,
      args,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(env !== undefined ? { env } : {}),
    }) as Promise<CliExecResult>;
  }

  async spawn(
    id: string,
    cmd: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<CliSpawnResult> {
    return this.rpc.call('cli.spawn', {
      id,
      cmd,
      args,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(env !== undefined ? { env } : {}),
    }) as Promise<CliSpawnResult>;
  }

  async kill(id: string): Promise<void> {
    await this.rpc.call('cli.kill', { id });
  }

  onOutput(handler: (params: CliOutputParams) => void): () => void {
    return this.rpc.onNotification('cli.output', (params) => handler(params as CliOutputParams));
  }

  onDone(handler: (params: CliDoneParams) => void): () => void {
    return this.rpc.onNotification('cli.done', (params) => handler(params as CliDoneParams));
  }
}