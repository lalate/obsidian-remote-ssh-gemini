import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Control ShadowVaultManager.openShadowFor (success vs failure) and
// stub the other three collaborators openShadowVaultFor constructs so
// the re-entrancy STATE MACHINE is exercised in isolation — no real
// disk bootstrap, registry, or window spawn.
const openShadowForMock = vi.fn();
vi.mock('../src/shadow/ShadowVaultManager', () => ({
  ShadowVaultManager: class {
    openShadowFor = openShadowForMock;
  },
}));
vi.mock('../src/shadow/ShadowVaultBootstrap', () => ({
  ShadowVaultBootstrap: class {},
}));
vi.mock('../src/shadow/WindowSpawner', () => ({
  WindowSpawner: class {},
}));
vi.mock('../src/shadow/ObsidianRegistry', () => ({
  ObsidianRegistry: class {
    static defaultConfigPath() { return '/synthetic/obsidian.json'; }
  },
}));
// main.ts's import graph pulls in RemoteTerminalView (extends the
// obsidian `ItemView`, which the unit-test obsidian mock does not
// model) — irrelevant to the spawn guard, so stub the leaf module.
vi.mock('../src/ui/RemoteTerminalView', () => ({
  RemoteTerminalView: class {},
  VIEW_TYPE_REMOTE_TERMINAL: 'remote-terminal',
}));

import { App, recordedNotices, clearNotices } from 'obsidian';
import RemoteSshPlugin from '../src/main';
import type { SshProfile } from '../src/types';

const profile = { id: 'p1', name: 'Prod', remotePath: '~/v' } as unknown as SshProfile;

function makePlugin(): RemoteSshPlugin {
  // Construct WITHOUT onload — openShadowVaultFor only needs
  // app.vault.{adapter,configDir}, manifest.id, settings.profiles.
  const plugin = new RemoteSshPlugin(new App() as never) as RemoteSshPlugin;
  (plugin as unknown as { settings: unknown }).settings = { profiles: [profile] };
  return plugin;
}

function okResult() {
  return {
    layout: { vaultDir: '/synthetic/shadow/p1' },
    registryId: 'reg-1',
    registryCreated: true,
    pluginInstallMethod: 'symlink' as const,
  };
}

describe('openShadowVaultFor — shadowSpawnInFlight guard (#352)', () => {
  beforeEach(() => {
    openShadowForMock.mockReset();
    clearNotices();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const inFlight = (p: RemoteSshPlugin) =>
    (p as unknown as { shadowSpawnInFlight: boolean }).shadowSpawnInFlight;

  it('a FAILED spawn clears the guard synchronously (instant retry, no 15s lockout)', async () => {
    const plugin = makePlugin();
    openShadowForMock.mockRejectedValue(new Error('bootstrap blew up'));

    await plugin.openShadowVaultFor(profile);

    // The bug: the old `finally` armed a 15s timer on the failure
    // path too, stranding the user. The flag must already be false
    // WITHOUT advancing any timer.
    expect(inFlight(plugin)).toBe(false);
    expect(recordedNotices().some((n) => /shadow vault failed/.test(n))).toBe(true);

    // And a retry must go through immediately (not be swallowed by a
    // lingering guard / "still opening" toast).
    openShadowForMock.mockResolvedValue(okResult());
    clearNotices();
    await plugin.openShadowVaultFor(profile);
    expect(openShadowForMock).toHaveBeenCalledTimes(2);
    expect(recordedNotices().some((n) => /still opening/.test(n))).toBe(false);
  });

  it('a SUCCESSFUL spawn holds the guard ~15s, then clears it', async () => {
    const plugin = makePlugin();
    openShadowForMock.mockResolvedValue(okResult());

    await plugin.openShadowVaultFor(profile);

    // Held immediately after a successful spawn (debounce window).
    expect(inFlight(plugin)).toBe(true);
    vi.advanceTimersByTime(14_999);
    expect(inFlight(plugin)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(inFlight(plugin)).toBe(false);
  });

  it('a second spawn WHILE one is in flight is rejected (no double obsidian://open)', async () => {
    const plugin = makePlugin();
    openShadowForMock.mockResolvedValue(okResult());

    await plugin.openShadowVaultFor(profile); // arms the 15s hold
    expect(inFlight(plugin)).toBe(true);
    clearNotices();

    await plugin.openShadowVaultFor(profile); // re-click during hold

    expect(openShadowForMock).toHaveBeenCalledTimes(1); // NOT 2
    expect(recordedNotices().some((n) => /still opening/.test(n))).toBe(true);
  });
});
