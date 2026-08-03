import { describe, it, expect, vi } from 'vitest';
import { ShadowVaultManager } from '../src/shadow/ShadowVaultManager';
import type { ShadowVaultBootstrap, BootstrapResult } from '../src/shadow/ShadowVaultBootstrap';
import type { WindowSpawner } from '../src/shadow/WindowSpawner';
import type { SshProfile } from '../src/types';

function makeProfile(id: string, name = id): SshProfile {
  return {
    id, name,
    host: 'h', port: 22, username: 'u', authMethod: 'privateKey',
    remotePath: '~/v/', privateKeyPath: '/dev/null',
    connectTimeoutMs: 5000, keepaliveIntervalMs: 10000, keepaliveCountMax: 3,
  } as SshProfile;
}

function makeResult(): BootstrapResult {
  return {
    layout: {
      vaultDir: '/tmp/v', configDir: '/tmp/v/.obsidian',
      pluginDir: '/tmp/v/.obsidian/plugins/remote-ssh',
      pluginDataFile: '/tmp/v/.obsidian/plugins/remote-ssh/data.json',
    },
    registryId: 'abc', registryCreated: false, pluginInstallMethod: 'symlink',
  };
}

describe('ShadowVaultManager.openShadowFor', () => {
  it('runs bootstrap then spawn, in that order, with the right args', async () => {
    const order: string[] = [];
    const fakeResult: BootstrapResult = {
      layout: {
        vaultDir: '/tmp/v', configDir: '/tmp/v/.obsidian',
        pluginDir: '/tmp/v/.obsidian/plugins/remote-ssh',
        pluginDataFile: '/tmp/v/.obsidian/plugins/remote-ssh/data.json',
      },
      registryId: 'abc', registryCreated: true, pluginInstallMethod: 'symlink',
    };
    const bootstrap = {
      bootstrap: vi.fn(async (..._args: unknown[]) => { order.push('bootstrap'); return fakeResult; }),
    } as unknown as ShadowVaultBootstrap;
    const spawner = {
      spawn: vi.fn((..._args: unknown[]) => { order.push('spawn'); return ''; }),
    } as unknown as WindowSpawner;

    const profile = makeProfile('p1');
    const all = [profile, makeProfile('p2')];
    const result = await new ShadowVaultManager(bootstrap, spawner).openShadowFor(profile, all);

    expect(order).toEqual(['bootstrap', 'spawn']);
    expect(bootstrap.bootstrap).toHaveBeenCalledWith(profile, all);
    expect(spawner.spawn).toHaveBeenCalledWith('/tmp/v');
    expect(result).toBe(fakeResult);
  });

  it('does NOT spawn if bootstrap throws', async () => {
    const bootstrap = {
      bootstrap: vi.fn(async () => { throw new Error('disk full'); }),
    } as unknown as ShadowVaultBootstrap;
    const spawner = {
      spawn: vi.fn(() => ''),
    } as unknown as WindowSpawner;

    const profile = makeProfile('p1');
    await expect(
      new ShadowVaultManager(bootstrap, spawner).openShadowFor(profile, [profile]),
    ).rejects.toThrow(/disk full/);
    expect(spawner.spawn).not.toHaveBeenCalled();
  });

  it('runs onBootstrapped AFTER bootstrap and BEFORE spawn, with the bootstrap result', async () => {
    const order: string[] = [];
    const fakeResult = makeResult();
    const bootstrap = {
      bootstrap: vi.fn(async () => { order.push('bootstrap'); return fakeResult; }),
    } as unknown as ShadowVaultBootstrap;
    const spawner = {
      spawn: vi.fn(() => { order.push('spawn'); return ''; }),
    } as unknown as WindowSpawner;
    let seen: BootstrapResult | null = null;
    const hook = vi.fn(async (r: BootstrapResult) => { order.push('hook'); seen = r; });

    const profile = makeProfile('p1');
    await new ShadowVaultManager(bootstrap, spawner).openShadowFor(profile, [profile], hook);

    expect(order, 'hook runs between bootstrap and spawn').toEqual(['bootstrap', 'hook', 'spawn']);
    expect(seen).toBe(fakeResult);
  });

  it('still spawns when onBootstrapped throws (graceful fallback — never blocks the window)', async () => {
    const fakeResult = makeResult();
    const bootstrap = {
      bootstrap: vi.fn(async () => fakeResult),
    } as unknown as ShadowVaultBootstrap;
    const spawner = {
      spawn: vi.fn(() => ''),
    } as unknown as WindowSpawner;
    const hook = vi.fn(async () => { throw new Error('pre-spawn pull failed'); });

    const profile = makeProfile('p1');
    const result = await new ShadowVaultManager(bootstrap, spawner)
      .openShadowFor(profile, [profile], hook);

    expect(hook).toHaveBeenCalledOnce();
    expect(spawner.spawn, 'a pre-spawn hook failure must NOT block the spawn')
      .toHaveBeenCalledWith('/tmp/v');
    expect(result).toBe(fakeResult);
  });
});
