import { describe, it, expect, vi } from 'vitest';
import { SharedConfigWatcher } from '../src/shadow/SharedConfigWatcher';

/**
 * Harness: a fake fs watcher whose `trigger(name)` simulates a file
 * event, a manual timer (`runTimer()` fires the pending debounce),
 * an in-memory local-content map, and a flush spy.
 */
function harness(local: Record<string, string> = {}) {
  let onChange: ((f: string | null) => void) | null = null;
  let closed = false;
  let pending: (() => void) | null = null;
  const flush = vi.fn(async (_changed: readonly string[]) => {});
  const w = new SharedConfigWatcher({
    watch: (cb) => { onChange = cb; return { close: () => { closed = true; } }; },
    readLocal: (b) => (b in local ? local[b] : null),
    flush,
    debounceMs: 1000,
    setTimer: (cb) => { pending = cb; return 1; },
    clearTimer: () => { pending = null; },
  });
  return {
    w, flush,
    trigger: (n: string | null) => onChange?.(n),
    runTimer: () => { const p = pending; pending = null; p?.(); },
    hasTimer: () => pending !== null,
    isClosed: () => closed,
    setLocal: (b: string, c: string) => { local[b] = c; },
  };
}

describe('SharedConfigWatcher', () => {
  it('pushes a genuinely changed shared file after the debounce', async () => {
    const h = harness({ 'app.json': '{"promptDelete":true}' });
    h.w.start();
    h.trigger('app.json');
    expect(h.flush).not.toHaveBeenCalled(); // debounced, not yet
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).toHaveBeenCalledWith(['app.json']);
  });

  it('suppresses the pull echo: markSynced content is not pushed back', async () => {
    const h = harness({ 'app.json': '{"a":1}' });
    h.w.markSynced('app.json', '{"a":1}'); // exactly what pull wrote locally
    h.w.start();
    h.trigger('app.json');               // the pull's own write event
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).not.toHaveBeenCalled();
  });

  it('pushes once the file actually diverges from the synced copy', async () => {
    const h = harness({ 'app.json': '{"a":1}' });
    h.w.markSynced('app.json', '{"a":1}');
    h.w.start();
    h.setLocal('app.json', '{"a":2}');   // user changed a setting
    h.trigger('app.json');
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).toHaveBeenCalledWith(['app.json']);
  });

  it('coalesces a burst of events into a single flush', async () => {
    const h = harness({ 'app.json': 'x', 'hotkeys.json': 'y' });
    h.w.start();
    h.trigger('app.json');
    h.trigger('app.json');
    h.trigger('hotkeys.json');
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).toHaveBeenCalledTimes(1);
    expect(h.flush.mock.calls[0][0].slice().sort())
      .toEqual(['app.json', 'hotkeys.json']);
  });

  it('ignores non-shared files (no debounce armed)', () => {
    const h = harness({});
    h.w.start();
    h.trigger('workspace.json'); // per-client, not shared
    h.trigger('random.md');
    expect(h.hasTimer()).toBe(false);
  });

  it('a null filename considers every shared file', async () => {
    const h = harness({ 'app.json': 'a', 'appearance.json': 'b' });
    h.w.start();
    h.trigger(null);
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).toHaveBeenCalledTimes(1);
    expect(h.flush.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['app.json', 'appearance.json']),
    );
  });

  it('stop() closes the watcher and cancels a pending flush', async () => {
    const h = harness({ 'app.json': 'x' });
    h.w.start();
    h.trigger('app.json');
    h.w.stop();
    expect(h.isClosed()).toBe(true);
    expect(h.hasTimer()).toBe(false);
    h.runTimer(); // nothing pending
    await Promise.resolve();
    expect(h.flush).not.toHaveBeenCalled();
  });

  it('a failed push is retried on the next change (not masked as synced)', async () => {
    const h = harness({ 'app.json': 'v1' });
    h.flush.mockRejectedValueOnce(new Error('ssh down'));
    h.w.start();
    h.trigger('app.json');
    h.runTimer();
    await Promise.resolve(); await Promise.resolve();
    expect(h.flush).toHaveBeenCalledTimes(1); // failed

    // Same content changes again later → must push again, because the
    // failed push must NOT have been recorded as synced.
    h.trigger('app.json');
    h.runTimer();
    await Promise.resolve();
    expect(h.flush).toHaveBeenCalledTimes(2);
  });
});
