import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferTracker } from '../src/util/TransferTracker';

describe('TransferTracker', () => {
  let tracker: TransferTracker;

  beforeEach(() => {
    tracker = new TransferTracker();
  });

  describe('begin / end', () => {
    it('returns null and skips registration for transfers below the 1 MB threshold', () => {
      const id = tracker.begin('up', 'note.md', 1024);
      expect(id).toBeNull();
      expect(tracker.snapshot()).toHaveLength(0);
    });

    it('returns an id and registers transfers >= 1 MB', () => {
      const id = tracker.begin('up', 'big.bin', TransferTracker.THRESHOLD_BYTES);
      expect(id).not.toBeNull();
      expect(tracker.snapshot()).toHaveLength(1);
      const t = tracker.snapshot()[0];
      expect(t.direction).toBe('up');
      expect(t.path).toBe('big.bin');
      expect(t.bytes).toBe(TransferTracker.THRESHOLD_BYTES);
      expect(t.startedAtMs).toBeGreaterThan(0);
      expect(t.id).toBe(id);
    });

    it('end() removes the transfer when given a valid id', () => {
      const id = tracker.begin('down', 'big.bin', 5_000_000);
      expect(tracker.snapshot()).toHaveLength(1);
      tracker.end(id);
      expect(tracker.snapshot()).toHaveLength(0);
    });

    it('end(null) is a no-op (matches begin\'s return for sub-threshold writes)', () => {
      tracker.begin('up', 'big.bin', 5_000_000);
      const before = tracker.snapshot().length;
      tracker.end(null);
      expect(tracker.snapshot()).toHaveLength(before);
    });

    it('multiple concurrent transfers each get a unique id', () => {
      const a = tracker.begin('up', 'a.bin', 5_000_000);
      const b = tracker.begin('down', 'b.bin', 5_000_000);
      const c = tracker.begin('up', 'c.bin', 5_000_000);
      expect(new Set([a, b, c]).size).toBe(3);
      expect(tracker.snapshot()).toHaveLength(3);
    });
  });

  describe('subscribe', () => {
    it('fires the listener on begin and end', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);

      const id = tracker.begin('up', 'big.bin', 5_000_000);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveLength(1);

      tracker.end(id);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0]).toHaveLength(0);
    });

    it('does not fire for sub-threshold begins (which return null)', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);
      tracker.begin('up', 'small.md', 100);
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const listener = vi.fn();
      const off = tracker.subscribe(listener);
      tracker.begin('up', 'big.bin', 5_000_000);
      expect(listener).toHaveBeenCalledTimes(1);

      off();
      tracker.begin('up', 'big2.bin', 5_000_000);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('a listener that throws does not break other listeners', () => {
      const bad = vi.fn(() => { throw new Error('boom'); });
      const good = vi.fn();
      tracker.subscribe(bad);
      tracker.subscribe(good);

      tracker.begin('up', 'big.bin', 5_000_000);
      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('drops every in-flight transfer and notifies', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);
      tracker.begin('up', 'a.bin', 5_000_000);
      tracker.begin('down', 'b.bin', 5_000_000);
      listener.mockClear();

      tracker.clear();
      expect(tracker.snapshot()).toHaveLength(0);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is a no-op (no notify) when nothing is in flight', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);
      tracker.clear();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('returns a fresh array (mutating it does not affect the tracker)', () => {
      tracker.begin('up', 'big.bin', 5_000_000);
      const snap = tracker.snapshot();
      snap.length = 0;
      expect(tracker.snapshot()).toHaveLength(1);
    });
  });
});
