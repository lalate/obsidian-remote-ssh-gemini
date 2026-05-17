import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  terminalInstances: [] as Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    emitData: (data: string) => void;
  }>,
  fitInstances: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }>,
  shellInstances: [] as Array<{
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    isOpen: ReturnType<typeof vi.fn>;
    emitData: (chunk: string) => void;
    emitClose: (reason: 'remote-eof' | 'error', cause?: unknown) => void;
  }>,
  pulseConflictStreamActivity: vi.fn(),
  clearConflictStreamActivity: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug_: vi.fn(),
  },
  nextShellOpenError: null as Error | null,
}));

// Keep the existing obsidian runtime mock, then augment only ItemView bits
// needed by View-class tests.
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');

  class ItemView {
    contentEl: HTMLElement;

    constructor(public readonly leaf: unknown) {
      this.contentEl = document.createElement('div');
    }

    getViewType(): string { return ''; }
    getDisplayText(): string { return ''; }
    getIcon(): string { return ''; }
    async onOpen(): Promise<void> {}
    async onClose(): Promise<void> {}
  }

  class WorkspaceLeaf {}

  return {
    ...actual,
    ItemView,
    WorkspaceLeaf,
  };
});

vi.mock('../../src/conflict/ConflictStreamGate', () => ({
  pulseConflictStreamActivity: mocks.pulseConflictStreamActivity,
  clearConflictStreamActivity: mocks.clearConflictStreamActivity,
}));

vi.mock('../../src/util/logger', () => ({ logger: mocks.logger }));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    private dataHandler: ((data: string) => void) | null = null;

    public readonly loadAddon = vi.fn();
    public readonly open = vi.fn();
    public readonly write = vi.fn();
    public readonly writeln = vi.fn();
    public readonly dispose = vi.fn();
    public readonly onData = vi.fn((cb: (data: string) => void) => {
      this.dataHandler = cb;
      return { dispose: vi.fn() };
    });

    constructor(_opts: Record<string, unknown>) {
      mocks.terminalInstances.push(this as never);
    }

    emitData(data: string): void {
      this.dataHandler?.(data);
    }
  }

  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    public readonly fit = vi.fn();
    public readonly proposeDimensions = vi.fn(() => ({ rows: 40, cols: 100 }));

    constructor() {
      mocks.fitInstances.push(this as never);
    }
  }

  return { FitAddon };
});

vi.mock('../../src/ssh/RemoteShell', () => {
  class RemoteShell {
    private opened = false;
    private handlers: {
      onData: (chunk: string) => void;
      onClose: (reason: 'remote-eof' | 'error', cause?: unknown) => void;
    };

    public readonly open = vi.fn(async (_opts: unknown) => {
      if (mocks.nextShellOpenError) {
        const err = mocks.nextShellOpenError;
        mocks.nextShellOpenError = null;
        throw err;
      }
      this.opened = true;
    });
    public readonly close = vi.fn(() => {
      this.opened = false;
    });
    public readonly write = vi.fn();
    public readonly resize = vi.fn();
    public readonly isOpen = vi.fn(() => this.opened);

    constructor(
      _client: unknown,
      handlers: {
        onData: (chunk: string) => void;
        onClose: (reason: 'remote-eof' | 'error', cause?: unknown) => void;
      },
    ) {
      this.handlers = handlers;
      mocks.shellInstances.push(this as never);
    }

    emitData(chunk: string): void {
      this.handlers.onData(chunk);
    }

    emitClose(reason: 'remote-eof' | 'error', cause?: unknown): void {
      this.handlers.onClose(reason, cause);
    }
  }

  return { RemoteShell };
});

import { RemoteTerminalView } from '../../src/ui/RemoteTerminalView';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  public readonly observe = vi.fn();
  public readonly disconnect = vi.fn();

  constructor(public readonly cb: () => void) {
    ResizeObserverMock.instances.push(this);
  }

  trigger(): void {
    this.cb();
  }
}

function makeDeps(connected = true) {
  const client = {
    isAlive: vi.fn(() => connected),
  };
  return {
    client,
    deps: {
      getClient: vi.fn(() => client),
      settings: {
        terminalFontSize: 14,
        terminalScrollback: 2000,
        terminalShell: '/bin/bash -l',
      },
    },
  };
}

describe('RemoteTerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.nextShellOpenError = null;
    mocks.terminalInstances.length = 0;
    mocks.fitInstances.length = 0;
    mocks.shellInstances.length = 0;
    ResizeObserverMock.instances.length = 0;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock;
  });

  it('未接続時は disconnected 表示を出して terminal を作らない', async () => {
    const { deps } = makeDeps(false);
    const view = new RemoteTerminalView({} as never, deps as never);

    await view.onOpen();

    expect(view.contentEl.textContent ?? '').toContain('Not connected');
    expect(mocks.terminalInstances).toHaveLength(0);
    expect(mocks.shellInstances).toHaveLength(0);
  });

  it('接続済み onOpen で terminal/shell を初期化し、open に寸法を渡す', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);

    await view.onOpen();

    expect(mocks.terminalInstances).toHaveLength(1);
    expect(mocks.fitInstances).toHaveLength(1);
    const term = mocks.terminalInstances[0];
    const shell = mocks.shellInstances[0];

    expect(term.loadAddon).toHaveBeenCalledWith(mocks.fitInstances[0]);
    expect(term.open).toHaveBeenCalledTimes(1);
    expect(shell.open).toHaveBeenCalledWith({
      rows: 40,
      cols: 100,
      cmd: '/bin/bash -l',
    });
  });

  it('terminal 入力が shell.write に流れ、shell 出力が terminal.write に流れる', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);

    await view.onOpen();

    const term = mocks.terminalInstances[0];
    const shell = mocks.shellInstances[0];

    term.emitData('ls -la\r');
    shell.emitData('output\r\n');

    expect(shell.write).toHaveBeenCalledWith('ls -la\r');
    expect(term.write).toHaveBeenCalledWith('output\r\n');
    expect(mocks.pulseConflictStreamActivity).toHaveBeenCalledTimes(1);
  });

  it('resize は debounce 後に fit と shell.resize を呼ぶ', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    await view.onOpen();

    const ro = ResizeObserverMock.instances[0];
    const fit = mocks.fitInstances[0];
    const shell = mocks.shellInstances[0];

    ro.trigger();
    ro.trigger();
    expect(fit.fit).toHaveBeenCalledTimes(1); // initial fit only

    vi.advanceTimersByTime(100);

    expect(fit.fit).toHaveBeenCalledTimes(2);
    expect(shell.resize).toHaveBeenCalledWith(40, 100);
  });

  it('onClose で observer/shell/terminal と conflict activity を解放する', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    await view.onOpen();

    const ro = ResizeObserverMock.instances[0];
    const shell = mocks.shellInstances[0];
    const term = mocks.terminalInstances[0];

    await view.onClose();

    expect(ro.disconnect).toHaveBeenCalledTimes(1);
    expect(shell.close).toHaveBeenCalledTimes(1);
    expect(term.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.clearConflictStreamActivity).toHaveBeenCalledTimes(1);
  });

  it('shell.open 失敗時は disconnected 表示にフォールバックし、構築途中リソースを解放する', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    mocks.nextShellOpenError = new Error('boom');

    await view.onOpen();

    expect(view.contentEl.textContent ?? '').toContain('Failed to open shell: boom');
    expect(mocks.shellInstances).toHaveLength(1);
    expect(mocks.shellInstances[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.terminalInstances).toHaveLength(1);
    expect(mocks.terminalInstances[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('resize 時に proposeDimensions が null なら shell.resize を呼ばない', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    await view.onOpen();

    const ro = ResizeObserverMock.instances[0];
    const fit = mocks.fitInstances[0];
    const shell = mocks.shellInstances[0];
    fit.proposeDimensions.mockReturnValueOnce(null);

    ro.trigger();
    vi.advanceTimersByTime(100);

    expect(shell.resize).not.toHaveBeenCalled();
  });

  it('remote-eof close を受けると info ログと Shell exited 表示を出す', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    await view.onOpen();

    const shell = mocks.shellInstances[0];
    const term = mocks.terminalInstances[0];
    shell.emitClose('remote-eof');

    expect(mocks.logger.info).toHaveBeenCalledWith('RemoteTerminalView: remote shell exited (eof)');
    expect(term.writeln).toHaveBeenCalledWith(expect.stringContaining('Shell exited.'));
  });

  it('error close を受けると warn ログと Shell error 表示を出す', async () => {
    const { deps } = makeDeps(true);
    const view = new RemoteTerminalView({} as never, deps as never);
    await view.onOpen();

    const shell = mocks.shellInstances[0];
    const term = mocks.terminalInstances[0];
    shell.emitClose('error', new Error('kaboom'));

    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('shell error: kaboom'));
    expect(term.writeln).toHaveBeenCalledWith(expect.stringContaining('Shell error: kaboom'));
  });
});
