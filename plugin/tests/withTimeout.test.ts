import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../src/util/withTimeout';

describe('withTimeout', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with the value when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });

  it('propagates the promise rejection when it rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });

  it('rejects with a labelled timeout error when the promise is too slow', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>(() => { /* never settles */ });
    const p = withTimeout(slow, 5000, 'pre-spawn pull');
    const assertion = expect(p).rejects.toThrow('pre-spawn pull timed out after 5000ms');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('clears the timer on a fast resolve so a later tick raises no timeout', async () => {
    vi.useFakeTimers();
    const p = withTimeout(Promise.resolve('fast'), 5000, 'x');
    await expect(p).resolves.toBe('fast');
    // Past the budget the cleared timer must not fire a stray rejection.
    await vi.advanceTimersByTimeAsync(10_000);
  });
});
