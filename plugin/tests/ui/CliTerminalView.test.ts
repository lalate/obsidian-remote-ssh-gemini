import { describe, it, expect, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', () => {
  class ItemView {
    public contentEl = {
      empty: vi.fn(),
      addClass: vi.fn(),
      createDiv: vi.fn(() => ({ createEl: vi.fn() })),
    };
    constructor(_leaf: unknown) {}
  }
  return { ItemView };
});

describe('CliTerminalView resume', () => {
  it('calls cli.spawn with resumeFrom = lastReceivedSeq + 1 after reconnect', async () => {
    const { CliTerminalView } = await import('../../src/ui/CliTerminalView');

    const call = vi.fn().mockResolvedValue({ ok: true });
    const fakeRpc = {
      isClosed: () => false,
      call,
      onNotification: () => () => {},
      onClose: () => () => {},
    };

    const deps = {
      getRpc: () => fakeRpc,
    };

    const view = new CliTerminalView({} as WorkspaceLeaf, deps as never) as unknown as {
      term: { write: (s: string) => void; writeln: (s: string) => void };
      activeSpawnId: string | null;
      lastSpawnPayload: { cmd: string; args: string[] } | null;
      lastReceivedSeq: number;
      waitingResume: boolean;
      tryResumeActiveProcess: () => Promise<void>;
    };

    view.term = {
      write: vi.fn(),
      writeln: vi.fn(),
    };
    view.activeSpawnId = 'resume-id';
    view.lastSpawnPayload = { cmd: 'gemini', args: ['--prompt', 'hello'] };
    view.lastReceivedSeq = 7;
    view.waitingResume = true;

    await view.tryResumeActiveProcess();

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('cli.spawn', {
      id: 'resume-id',
      cmd: 'gemini',
      args: ['--prompt', 'hello'],
      persist: true,
      resumeFrom: 8,
    });
  });
});
