import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalOpRegistry } from '../src/adapter/LocalOpRegistry';

/**
 * Deterministic time control: the registry keys entirely off
 * `Date.now()`, so a fake system clock makes TTL behaviour exact and
 * non-flaky (no real sleeps).
 */
describe('LocalOpRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a recorded path as self-originated within the TTL', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['Notes/a.md']);
    expect(reg.isSelfOriginated('Notes/a.md')).toBe(true);
  });

  it('reports an unrecorded path as not self-originated', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['a.md']);
    expect(reg.isSelfOriginated('b.md')).toBe(false);
  });

  it('records every path in the batch (rename → old + new)', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['old.md', 'new.md']);
    expect(reg.isSelfOriginated('old.md')).toBe(true);
    expect(reg.isSelfOriginated('new.md')).toBe(true);
  });

  it('does NOT consume the entry — repeated checks stay true (split rename echo)', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['x.md']);
    expect(reg.isSelfOriginated('x.md')).toBe(true);
    expect(reg.isSelfOriginated('x.md')).toBe(true); // delete echo + create echo
  });

  it('expires an entry once the TTL elapses', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['gone.md']);
    vi.setSystemTime(1_001);
    expect(reg.isSelfOriginated('gone.md')).toBe(false);
  });

  it('keeps an entry live right up to (not past) the TTL boundary', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['edge.md']);
    vi.setSystemTime(1_000); // == expiresAt, Date.now() > expiresAt is false
    expect(reg.isSelfOriginated('edge.md')).toBe(true);
  });

  it('prunes stale entries on a later record so the map cannot grow unbounded', () => {
    const reg = new LocalOpRegistry(1_000);
    reg.record(['stale.md']);
    vi.setSystemTime(2_000);
    reg.record(['fresh.md']); // triggers prune of stale.md
    expect(reg.isSelfOriginated('stale.md')).toBe(false);
    expect(reg.isSelfOriginated('fresh.md')).toBe(true);
  });

  it('defaults to a 5s TTL when none is supplied', () => {
    const reg = new LocalOpRegistry();
    reg.record(['d.md']);
    vi.setSystemTime(4_999);
    expect(reg.isSelfOriginated('d.md')).toBe(true);
    vi.setSystemTime(5_001);
    expect(reg.isSelfOriginated('d.md')).toBe(false);
  });
});
