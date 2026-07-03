import { describe, it, expect, vi } from 'vitest';
import { LazyFolderLoader } from '../src/vault/LazyFolderLoader';
import type { BulkWalker } from '../src/vault/BulkWalker';
import type { VaultModelBuilder } from '../src/vault/VaultModelBuilder';

function fakeWalk(path: string) {
  return {
    entries: [{ path: `${path}/child.md`, isDirectory: false, ctime: 0, mtime: 0, size: 0 }],
    source: 'rpc-walk' as const,
    truncated: false,
    walkMs: 1,
    pages: 1,
    fastPathError: null,
  };
}

function makeBuilder(): VaultModelBuilder & { buildChunked: ReturnType<typeof vi.fn> } {
  return {
    buildChunked: vi.fn(async (entries: readonly unknown[]) => ({
      filesAdded: entries.length, foldersAdded: 0, skipped: 0, errors: [],
    })),
  } as unknown as VaultModelBuilder & { buildChunked: ReturnType<typeof vi.fn> };
}

describe('LazyFolderLoader', () => {
  it('loadFolder walks ONE level (recursive=false) and builds the children', async () => {
    const walk = vi.fn(async (path: string, _recursive: boolean) => fakeWalk(path));
    const builder = makeBuilder();
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => builder);

    await loader.loadFolder('work/sub');

    expect(walk).toHaveBeenCalledExactlyOnceWith('work/sub', false);
    expect(builder.buildChunked).toHaveBeenCalledOnce();
    expect(loader.isLoaded('work/sub')).toBe(true);
  });

  it('is idempotent — a second load of the same folder does not re-walk', async () => {
    const walk = vi.fn(async (path: string) => fakeWalk(path));
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => makeBuilder());
    await loader.loadFolder('a');
    await loader.loadFolder('a');
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent loads of the same folder into one walk', async () => {
    const walk = vi.fn(async (path: string) => fakeWalk(path));
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => makeBuilder());
    await Promise.all([loader.loadFolder('b'), loader.loadFolder('b'), loader.loadFolder('b')]);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('markLoaded skips the walk entirely', async () => {
    const walk = vi.fn(async (path: string) => fakeWalk(path));
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => makeBuilder());
    loader.markLoaded('c');
    await loader.loadFolder('c');
    expect(walk).not.toHaveBeenCalled();
  });

  it('a failed walk leaves the folder unloaded so a later expand retries', async () => {
    const walk = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fakeWalk('x'));
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => makeBuilder());

    await loader.loadFolder('x');
    expect(loader.isLoaded('x')).toBe(false);   // failed → not marked loaded

    await loader.loadFolder('x');               // retry succeeds
    expect(walk).toHaveBeenCalledTimes(2);
    expect(loader.isLoaded('x')).toBe(true);
  });

  it('reset clears loaded state', async () => {
    const walk = vi.fn(async (path: string) => fakeWalk(path));
    const loader = new LazyFolderLoader(() => ({ walk } as unknown as BulkWalker), () => makeBuilder());
    await loader.loadFolder('a');
    expect(loader.isLoaded('a')).toBe(true);
    loader.reset();
    expect(loader.isLoaded('a')).toBe(false);
  });
});
