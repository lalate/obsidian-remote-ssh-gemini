import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { RpcClient } from '../transport/RpcClient';
import type { CliOutputParams, CliOutputBatchParams } from '../proto/types';
import { logger } from '../util/logger';
import { errorMessage } from '../util/errorMessage';

export const VIEW_TYPE_CLI_TERMINAL = 'remote-ssh-cli-terminal';

/**
 * Dependency surface the view needs from the host plugin.
 */
export interface CliTerminalDeps {
  /** Returns the active RpcClient, or null when not connected. */
  getRpc(): RpcClient | null;
}

const ANSI_GREEN  = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED    = '\x1b[31m';
const ANSI_CYAN   = '\x1b[36m';
const ANSI_RESET  = '\x1b[0m';

/**
 * Streaming CLI terminal pane for Gemini / git commands.
 *
 * The view uses `cli.spawn` so output streams to the xterm.js buffer
 * in real time. A running process can be stopped with `cli.kill`.
 * Output is appended to the scrollback — previous runs are preserved
 * until the pane is closed.
 *
 * Protocol flow:
 *   1. User enters a prompt and presses Enter or clicks Run.
 *   2. View calls `cli.spawn { id, cmd: "gemini", args: ["--prompt", text] }`.
 *   3. Server emits `cli.output` notifications for each stdout/stderr chunk.
 *   4. Server emits `cli.done` once the process exits.
 *   5. View unsubscribes and re-enables the input row.
 */
export class CliTerminalView extends ItemView {
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private inputEl: HTMLInputElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private resizeTimer: number | null = null;
  private resumeTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** Disposers for active cli.output / cli.done notification handlers. */
  private activeDisposers: Array<() => void> = [];
  /** Correlation id of the currently running spawn, or null. */
  private activeSpawnId: string | null = null;
  /** Counter to generate unique spawn ids within this session. */
  private spawnSeq = 0;
  /** Last received sequence number for the active process. */
  private lastReceivedSeq = -1;
  /** Last spawned command payload for reconnect-time resume calls. */
  private lastSpawnPayload: { cmd: string; args: string[] } | null = null;
  /** True while waiting to resume a running process after reconnect. */
  private waitingResume = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: CliTerminalDeps,
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CLI_TERMINAL; }
  getDisplayText(): string { return 'Gemini CLI'; }
  getIcon(): string { return 'bot'; }

  async onOpen(): Promise<void> {
    const host = this.contentEl;
    host.empty();
    host.addClass('remote-ssh-cli-terminal-host');

    const rpc = this.deps.getRpc();
    if (!rpc) {
      this.renderDisconnected('Not connected — run "Remote SSH: Connect" first.');
      return;
    }

    // ── xterm output area ─────────────────────────────────────────────
    const xtermContainer = host.createDiv({ cls: 'remote-ssh-terminal-pane remote-ssh-cli-output' });

    this.term = new Terminal({
      fontSize: 13,
      scrollback: 5000,
      fontFamily: 'Menlo, Consolas, monospace',
      cursorBlink: false,
      disableStdin: true,
      cols: 80,
      rows: 24,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(xtermContainer);

    try {
      this.fit.fit();
    } catch {
      // best-effort — ResizeObserver will correct it once layout settles
    }

    this.term.writeln(`${ANSI_CYAN}Gemini CLI — streaming terminal${ANSI_RESET}`);
    this.term.writeln(`${ANSI_CYAN}Type a prompt and press Enter or click Run.${ANSI_RESET}`);
    this.term.writeln('');

    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(xtermContainer);

    // ── input row ─────────────────────────────────────────────────────
    const inputRow = host.createDiv({ cls: 'remote-ssh-cli-input-row' });

    this.inputEl = inputRow.createEl('input', {
      type: 'text',
      placeholder: 'Enter a prompt for Gemini…',
      cls: 'remote-ssh-cli-input',
    });

    this.runBtn = inputRow.createEl('button', {
      text: 'Run',
      cls: 'mod-cta remote-ssh-cli-run-btn',
    });

    this.stopBtn = inputRow.createEl('button', {
      text: 'Stop',
      cls: 'remote-ssh-cli-stop-btn',
    });
    this.stopBtn.disabled = true;

    // Submit on Enter
    this.inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !this.runBtn?.disabled) {
        void this.runPrompt();
      }
    });

    this.runBtn.addEventListener('click', () => { void this.runPrompt(); });
    this.stopBtn.addEventListener('click', () => { void this.killActiveProcess(); });
  }

  onClose(): Promise<void> {
    if (this.resizeTimer !== null) {
      activeWindow.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.resumeTimer !== null) {
      activeWindow.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.disposeActiveHandlers();
    this.term?.dispose();
    this.term = null;
    this.fit = null;
    return Promise.resolve();
  }

  // ── private helpers ────────────────────────────────────────────────

  private async runPrompt(): Promise<void> {
    const rpc = this.deps.getRpc();
    if (!rpc) {
      this.term?.writeln(`${ANSI_RED}[Not connected]${ANSI_RESET}`);
      return;
    }

    const prompt = this.inputEl?.value.trim() ?? '';
    if (!prompt) return;

    this.setRunning(true);
    if (this.inputEl) this.inputEl.value = '';

    const id = `cli-${++this.spawnSeq}-${Date.now()}`;
    this.activeSpawnId = id;
    this.lastSpawnPayload = { cmd: 'gemini', args: ['--prompt', prompt] };
    this.waitingResume = false;

    this.term?.writeln('');
    this.term?.writeln(`${ANSI_GREEN}▶ gemini --prompt "${prompt}"${ANSI_RESET}`);

    this.lastReceivedSeq = -1;

    const handleChunk = (params: CliOutputParams) => {
      if (params.id !== id) return;
      this.lastReceivedSeq = Math.max(this.lastReceivedSeq, params.seq);
      const color = params.stream === 'stderr' ? ANSI_YELLOW : '';
      // Convert \n to \r\n for xterm
      const text = params.data.replace(/\n/g, '\r\n');
      this.term?.write(color ? `${color}${text}${ANSI_RESET}` : text);
    };

    this.attachProcessHandlers(rpc, id, handleChunk);

    try {
      await rpc.call('cli.spawn', {
        id,
        cmd: this.lastSpawnPayload.cmd,
        args: this.lastSpawnPayload.args,
        persist: true,
      });
    } catch (e) {
      this.disposeActiveHandlers();
      this.activeSpawnId = null;
      this.term?.writeln(`${ANSI_RED}[cli.spawn failed: ${errorMessage(e)}]${ANSI_RESET}`);
      logger.warn(`CliTerminalView: cli.spawn error: ${errorMessage(e)}`);
      this.setRunning(false);
    }
  }

  private async killActiveProcess(): Promise<void> {
    const rpc = this.deps.getRpc();
    const id = this.activeSpawnId;
    if (!rpc || !id) return;
    try {
      await rpc.call('cli.kill', { id });
    } catch (e) {
      logger.warn(`CliTerminalView: cli.kill error: ${errorMessage(e)}`);
    }
  }

  private disposeActiveHandlers(): void {
    for (const d of this.activeDisposers) d();
    this.activeDisposers = [];
  }

  private attachProcessHandlers(
    rpc: RpcClient,
    id: string,
    onChunk: (params: CliOutputParams) => void,
  ): void {
    this.disposeActiveHandlers();

    const disposeOutput = rpc.onNotification('cli.output', (params) => {
      onChunk(params as CliOutputParams);
    });

    const disposeBatch = rpc.onNotification('cli.output.batch', (params) => {
      const batch = params as CliOutputBatchParams;
      for (const chunk of batch.chunks) {
        onChunk(chunk);
      }
    });

    const disposeDone = rpc.onNotification('cli.done', (params) => {
      if (params.id !== id) return;
      this.disposeActiveHandlers();
      this.activeSpawnId = null;
      this.lastSpawnPayload = null;
      this.waitingResume = false;
      this.term?.writeln('');
      if (params.error) {
        this.term?.writeln(`${ANSI_RED}[Process error: ${params.error}]${ANSI_RESET}`);
      } else if (params.exitCode !== 0) {
        this.term?.writeln(`${ANSI_YELLOW}[Exited with code ${params.exitCode}]${ANSI_RESET}`);
      } else {
        this.term?.writeln(`${ANSI_GREEN}[Done]${ANSI_RESET}`);
      }
      this.setRunning(false);
    });

    const disposeClose = rpc.onClose(() => {
      if (this.activeSpawnId !== id || !this.lastSpawnPayload) return;
      this.disposeActiveHandlers();
      this.waitingResume = true;
      this.term?.writeln('');
      this.term?.writeln(`${ANSI_YELLOW}[Connection lost. Attempting to resume…]${ANSI_RESET}`);
      this.scheduleResumeAttempt();
    });

    this.activeDisposers = [disposeOutput, disposeBatch, disposeDone, disposeClose];
  }

  private scheduleResumeAttempt(): void {
    if (this.resumeTimer !== null) activeWindow.clearTimeout(this.resumeTimer);
    this.resumeTimer = activeWindow.setTimeout(() => {
      this.resumeTimer = null;
      void this.tryResumeActiveProcess();
    }, 1000);
  }

  private async tryResumeActiveProcess(): Promise<void> {
    if (!this.waitingResume || !this.activeSpawnId || !this.lastSpawnPayload) return;

    const rpc = this.deps.getRpc();
    if (!rpc || rpc.isClosed()) {
      this.scheduleResumeAttempt();
      return;
    }

    const id = this.activeSpawnId;
    const resumeFrom = Math.max(0, this.lastReceivedSeq + 1);
    const onChunk = (params: CliOutputParams) => {
      if (params.id !== id) return;
      this.lastReceivedSeq = Math.max(this.lastReceivedSeq, params.seq);
      const color = params.stream === 'stderr' ? ANSI_YELLOW : '';
      const text = params.data.replace(/\n/g, '\r\n');
      this.term?.write(color ? `${color}${text}${ANSI_RESET}` : text);
    };

    this.attachProcessHandlers(rpc, id, onChunk);

    try {
      await rpc.call('cli.spawn', {
        id,
        cmd: this.lastSpawnPayload.cmd,
        args: this.lastSpawnPayload.args,
        persist: true,
        resumeFrom,
      });
      this.waitingResume = false;
      this.term?.writeln(`${ANSI_CYAN}[Resumed from seq ${resumeFrom}]${ANSI_RESET}`);
    } catch (e) {
      const msg = errorMessage(e);
      if (msg.includes('unknown id')) {
        this.waitingResume = false;
        this.activeSpawnId = null;
        this.lastSpawnPayload = null;
        this.setRunning(false);
        this.disposeActiveHandlers();
        this.term?.writeln(`${ANSI_RED}[Resume failed: process no longer exists]${ANSI_RESET}`);
        return;
      }
      logger.warn(`CliTerminalView: resume error: ${msg}`);
      this.scheduleResumeAttempt();
    }
  }

  private setRunning(running: boolean): void {
    if (this.runBtn)  this.runBtn.disabled  = running;
    if (this.stopBtn) this.stopBtn.disabled = !running;
    if (this.inputEl) this.inputEl.disabled = running;
  }

  private scheduleResize(): void {
    if (this.resizeTimer !== null) activeWindow.clearTimeout(this.resizeTimer);
    this.resizeTimer = activeWindow.setTimeout(() => {
      this.resizeTimer = null;
      if (!this.fit || !this.term) return;
      try { this.fit.fit(); } catch (e) {
        logger.debug_(`CliTerminalView.resize: ${errorMessage(e)}`);
      }
    }, 100);
  }

  private renderDisconnected(message: string): void {
    this.contentEl.empty();
    this.contentEl.addClass('remote-ssh-cli-terminal-host');
    const box = this.contentEl.createDiv({ cls: 'remote-ssh-terminal-disconnected' });
    box.createEl('p', { text: message });
  }
}
