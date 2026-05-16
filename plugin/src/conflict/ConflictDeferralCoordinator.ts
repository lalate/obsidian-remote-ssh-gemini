import { App, Notice } from 'obsidian';
import { isConflictStreamBusy } from './ConflictStreamGate';
import type { TextConflictDecision, ThreeWayPanes } from './ConflictResolver';

type TextTask = {
  kind: 'text';
  path: string;
  panes: ThreeWayPanes;
  openModal: () => Promise<TextConflictDecision>;
};

type BinaryTask = {
  kind: 'binary';
  path: string;
  openModal: () => Promise<boolean>;
};

type DeferredTask = TextTask | BinaryTask;

export class ConflictDeferralCoordinator {
  private readonly queue: DeferredTask[] = [];
  private idleTimer: number | null = null;
  private notifiedDeferred = false;
  private notifiedReady = false;

  constructor(
    private readonly app: App,
    private readonly isAutoResumeEnabled: () => boolean,
  ) {}

  async handleTextConflict(
    path: string,
    panes: ThreeWayPanes,
    openModal: () => Promise<TextConflictDecision>,
  ): Promise<TextConflictDecision> {
    if (!this.shouldDefer()) {
      return await openModal();
    }
    this.enqueue({ kind: 'text', path, panes, openModal });
    return { decision: 'cancel' };
  }

  async handleBinaryConflict(
    path: string,
    openModal: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!this.shouldDefer()) {
      return await openModal();
    }
    this.enqueue({ kind: 'binary', path, openModal });
    return false;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
    this.stopIdleWatcher();
    this.notifiedDeferred = false;
    this.notifiedReady = false;
  }

  async resolvePendingConflicts(): Promise<number> {
    if (this.queue.length === 0) return 0;
    // Open one-by-one so modal UX remains predictable.
    let opened = 0;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      opened += 1;
      try {
        if (task.kind === 'text') {
          await task.openModal();
        } else {
          await task.openModal();
        }
      } catch {
        // Keep walking remaining tasks; a modal cancellation should not abort the queue.
      }
      new Notice(`Remote SSH: conflict review opened for ${task.path}. Re-save if you want to apply your decision.`);
    }
    this.stopIdleWatcher();
    this.notifiedReady = false;
    return opened;
  }

  private shouldDefer(): boolean {
    return this.isAutoResumeEnabled() && isConflictStreamBusy();
  }

  private enqueue(task: DeferredTask): void {
    this.queue.push(task);
    if (!this.notifiedDeferred) {
      this.notifiedDeferred = true;
      new Notice('Remote SSH: stream is busy, conflict resolution deferred to keep UI responsive.');
    }
    this.startIdleWatcher();
  }

  private startIdleWatcher(): void {
    if (this.idleTimer !== null) return;
    this.idleTimer = activeWindow.setInterval(() => {
      if (this.queue.length === 0) {
        this.stopIdleWatcher();
        this.notifiedReady = false;
        return;
      }
      if (isConflictStreamBusy()) return;
      if (this.notifiedReady) return;
      this.notifiedReady = true;
      new Notice(`Remote SSH: ${this.queue.length} deferred conflict(s) pending. Run "Resolve deferred conflicts".`);
    }, 750);
  }

  private stopIdleWatcher(): void {
    if (this.idleTimer === null) return;
    activeWindow.clearInterval(this.idleTimer);
    this.idleTimer = null;
  }
}
