import { describe, it, expect, vi } from 'vitest';
import { WsRemoteCliClient } from '../src/adapter/WsRemoteCliClient';

function makeRpcClient(results: Record<string, unknown> = {}) {
  const handlers = new Map<string, Array<(params: unknown) => void>>();
  return {
    call: vi.fn(async (method: string, _params: unknown) => {
      if (!(method in results)) throw new Error(`No stub for ${method}`);
      return results[method];
    }),
    onNotification(method: string, handler: (params: unknown) => void) {
      const list = handlers.get(method) ?? [];
      list.push(handler);
      handlers.set(method, list);
      return () => {
        const current = handlers.get(method);
        if (!current) return;
        const idx = current.indexOf(handler);
        if (idx >= 0) current.splice(idx, 1);
      };
    },
    _emit(method: string, params: unknown) {
      for (const handler of handlers.get(method) ?? []) handler(params);
    },
  };
}

describe('WsRemoteCliClient', () => {
  it('exec() forwards cli.exec params and returns the result', async () => {
    const rpc = makeRpcClient({ 'cli.exec': { stdout: 'ok', stderr: '', exitCode: 0 } });
    const client = new WsRemoteCliClient(rpc as any);

    await expect(client.exec('git', ['--version'])).resolves.toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    expect(rpc.call).toHaveBeenCalledWith('cli.exec', { cmd: 'git', args: ['--version'] });
  });

  it('spawn() forwards optional cwd/env and returns ok', async () => {
    const rpc = makeRpcClient({ 'cli.spawn': { ok: true } });
    const client = new WsRemoteCliClient(rpc as any);

    await expect(client.spawn('id-1', 'gemini', ['--help'], 'docs', { FOO: 'bar' })).resolves.toEqual({ ok: true });
    expect(rpc.call).toHaveBeenCalledWith('cli.spawn', {
      id: 'id-1',
      cmd: 'gemini',
      args: ['--help'],
      cwd: 'docs',
      env: { FOO: 'bar' },
    });
  });

  it('kill() forwards cli.kill and resolves', async () => {
    const rpc = makeRpcClient({ 'cli.kill': {} });
    const client = new WsRemoteCliClient(rpc as any);

    await client.kill('id-2');
    expect(rpc.call).toHaveBeenCalledWith('cli.kill', { id: 'id-2' });
  });

  it('onOutput/onDone relay notifications', () => {
    const rpc = makeRpcClient();
    const client = new WsRemoteCliClient(rpc as any);
    const output = vi.fn();
    const done = vi.fn();

    client.onOutput(output);
    client.onDone(done);

    (rpc as any)._emit('cli.output', { id: 'x', stream: 'stdout', data: 'chunk' });
    (rpc as any)._emit('cli.done', { id: 'x', exitCode: 0 });

    expect(output).toHaveBeenCalledWith({ id: 'x', stream: 'stdout', data: 'chunk' });
    expect(done).toHaveBeenCalledWith({ id: 'x', exitCode: 0 });
  });
});