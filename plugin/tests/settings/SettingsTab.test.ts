import { describe, it, expect, vi } from 'vitest';
import {
  App, clickButton, findButton, getSettingsIn, recordedNotices,
  type TextComponent, type ToggleComponent,
} from 'obsidian';
import type RemoteSshPlugin from '../../src/main';
import type { PluginSettings, SshProfile } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/constants';

// Isolate from the real telemetry singleton so the toggle's
// `await telemetry.setEnabled(true, ...)` doesn't try to mkdir the
// synthetic vault path or persist any flush state across tests.
vi.mock('../../src/util/Telemetry', () => ({
  telemetry: {
    isEnabled: () => false,
    setEnabled: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    snapshot: () => [],
    reset: vi.fn(),
  },
  telemetryLogPath: () => '/synthetic/telemetry.log',
}));

import { SettingsTab } from '../../src/settings/SettingsTab';

// The slice of RemoteSshPlugin that SettingsTab actually touches —
// keeps the stub type-safe so new required methods on the real class
// surface here as a compile error rather than a silent runtime failure.
interface SettingsTabPlugin {
  settings: PluginSettings;
  manifest: { id: string };
  saveSettings(): Promise<void>;
  disconnect(): Promise<void>;
  openShadowVaultFor(p: SshProfile): Promise<void>;
  isConnected(): boolean;
  getProfileFormDeps(): { authResolver: never; hostKeyStore: never };
  getDaemonStatus(): ReturnType<RemoteSshPlugin['getDaemonStatus']>;
  readDaemonLog(): Promise<string>;
  restartDaemon(): Promise<void>;
}

interface FakePluginOpts {
  settings?: Partial<PluginSettings>;
  isConnected?: boolean;
  daemonStatus?: ReturnType<RemoteSshPlugin['getDaemonStatus']>;
  restartFails?: boolean;
}

type RecordedPlugin = SettingsTabPlugin & {
  saveCalls: number;
  disconnectCalls: number;
  openShadowCalls: SshProfile[];
  restartCalls: number;
};

function fakePlugin(opts: FakePluginOpts = {}): RecordedPlugin {
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const stub: RecordedPlugin = {
    settings,
    manifest: { id: 'remote-ssh' },
    saveCalls: 0,
    disconnectCalls: 0,
    openShadowCalls: [],
    restartCalls: 0,
    async saveSettings() { stub.saveCalls += 1; },
    async disconnect() { stub.disconnectCalls += 1; },
    async openShadowVaultFor(p) { stub.openShadowCalls.push(p); },
    isConnected: () => Boolean(opts.isConnected),
    getProfileFormDeps: () => ({ authResolver: {} as never, hostKeyStore: {} as never }),
    getDaemonStatus: () => opts.daemonStatus ?? { status: 'none' as const },
    async readDaemonLog() { return '(no log)'; },
    async restartDaemon() {
      stub.restartCalls += 1;
      if (opts.restartFails) throw new Error('boom');
    },
  };
  return stub;
}

function profile(overrides: Partial<SshProfile> = {}): SshProfile {
  return {
    id: 'p1',
    name: 'My host',
    host: 'host.example',
    port: 22,
    username: 'me',
    authMethod: 'privateKey',
    remotePath: '~/notes',
    transport: 'sftp',
    connectTimeoutMs: 15000,
    keepaliveIntervalMs: 10000,
    keepaliveCountMax: 3,
    ...overrides,
  };
}

function displayTab(plugin: RecordedPlugin): SettingsTab {
  const tab = new SettingsTab(new App(), plugin as unknown as RemoteSshPlugin);
  tab.display();
  return tab;
}

describe('SettingsTab', () => {
  describe('display() — base render', () => {
    it('shows the SSH profiles heading + add-profile setting', () => {
      const text = displayTab(fakePlugin()).containerEl.textContent ?? '';
      expect(text).toContain('SSH profiles');
      expect(text).toContain('Add profile');
      expect(text).toContain('This device');
      expect(text).toContain('Advanced');
    });

    it('omits the Daemon section when not connected (status: none)', () => {
      const tab = displayTab(fakePlugin({ daemonStatus: { status: 'none' } }));
      expect(tab.containerEl.textContent ?? '').not.toContain('Daemon');
    });

    it('renders the Daemon section when status is running', () => {
      const tab = displayTab(fakePlugin({
        daemonStatus: { status: 'running', version: '1.2.3', capabilities: 7 },
      }));
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Daemon');
      expect(text).toContain('🟢 Running');
      expect(text).toContain('v1.2.3');
      expect(text).toContain('7 capabilities');
    });

    it('renders the Daemon section as Down when status is down', () => {
      const tab = displayTab(fakePlugin({ daemonStatus: { status: 'down' } }));
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('🔴 Down');
      expect(text).toContain('RPC connection lost');
    });
  });

  describe('display() — profile rows', () => {
    it('renders one row per saved profile', () => {
      const tab = displayTab(fakePlugin({
        settings: {
          profiles: [
            profile({ id: 'p1', name: 'Alpha' }),
            profile({ id: 'p2', name: 'Beta', host: 'beta.example' }),
          ],
        },
      }));
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Alpha');
      expect(text).toContain('Beta');
      expect(text).toContain('me@beta.example:22');
    });

    it('shows "Connect" button on a non-active profile (isConnected=false)', () => {
      const tab = displayTab(fakePlugin({
        settings: { profiles: [profile()] },
        isConnected: false,
      }));
      expect(findButton(tab.containerEl, 'Connect')).not.toBeNull();
    });
  });

  describe('Connect / Disconnect buttons', () => {
    it('Connect click calls openShadowVaultFor with the profile', async () => {
      const p = profile();
      const plugin = fakePlugin({ settings: { profiles: [p] }, isConnected: false });
      const tab = displayTab(plugin);
      await clickButton(tab.containerEl, 'Connect');
      expect(plugin.openShadowCalls).toEqual([p]);
      expect(plugin.disconnectCalls).toBe(0);
    });

    it('Disconnect click (active profile) calls plugin.disconnect()', async () => {
      const p = profile({ id: 'active-1' });
      const plugin = fakePlugin({
        settings: { profiles: [p], activeProfileId: 'active-1' },
        isConnected: true,
      });
      const tab = displayTab(plugin);
      await clickButton(tab.containerEl, 'Disconnect');
      expect(plugin.disconnectCalls).toBe(1);
      expect(plugin.openShadowCalls).toEqual([]);
    });
  });

  describe('Client ID + reconnect text fields drive saveSettings', () => {
    it('clientId input runs sanitizeClientId and persists', async () => {
      const plugin = fakePlugin({ settings: { clientId: '' } });
      const tab = displayTab(plugin);
      const input = findTextByDescContains(tab.containerEl, 'Per-device subtree name');
      await input.simulateInput('bad/char!');
      // sanitizeClientId collapses runs of disallowed chars into a single
      // '-' and trims leading/trailing '-' (PathMapper.ts).
      expect(plugin.settings.clientId).toBe('bad-char');
      expect(plugin.saveCalls).toBe(1);
    });

    it('clientId blank input resets to empty (use-default sentinel)', async () => {
      const plugin = fakePlugin({ settings: { clientId: 'old' } });
      const tab = displayTab(plugin);
      const input = findTextByDescContains(tab.containerEl, 'Per-device subtree name');
      await input.simulateInput('   ');
      expect(plugin.settings.clientId).toBe('');
      expect(plugin.saveCalls).toBe(1);
    });

    it('reconnect attempts input persists valid integer in [0,100]', async () => {
      const plugin = fakePlugin({ settings: { reconnectMaxRetries: 7 } });
      const tab = displayTab(plugin);
      const input = findTextByDescContains(tab.containerEl, 'Number of times to retry');
      await input.simulateInput('3');
      expect(plugin.settings.reconnectMaxRetries).toBe(3);
      expect(plugin.saveCalls).toBe(1);
    });

    it('reconnect attempts input rejects out-of-range value (no save)', async () => {
      const plugin = fakePlugin({ settings: { reconnectMaxRetries: 7 } });
      const tab = displayTab(plugin);
      const input = findTextByDescContains(tab.containerEl, 'Number of times to retry');
      await input.simulateInput('999');
      expect(plugin.settings.reconnectMaxRetries).toBe(7);
      expect(plugin.saveCalls).toBe(0);
    });
  });

  describe('Telemetry toggle', () => {
    it('renders the enable-toggle setting', () => {
      const text = displayTab(fakePlugin()).containerEl.textContent ?? '';
      expect(text).toContain('Telemetry');
      expect(text).toContain('Enable anonymous telemetry');
      expect(text).toContain('nothing is sent over the network');
    });

    it('flipping the toggle persists telemetryEnabled and re-renders', async () => {
      const plugin = fakePlugin({ settings: { telemetryEnabled: false } });
      const tab = displayTab(plugin);
      const toggle = findToggleByName(tab.containerEl, 'Enable anonymous telemetry');
      await toggle.simulateChange(true);
      expect(plugin.settings.telemetryEnabled).toBe(true);
      expect(plugin.saveCalls).toBe(1);
    });
  });

  describe('Daemon panel buttons', () => {
    it('Restart click calls plugin.restartDaemon()', async () => {
      const plugin = fakePlugin({
        daemonStatus: { status: 'running', version: '1.2.3', capabilities: 7 },
      });
      const tab = displayTab(plugin);
      await clickButton(tab.containerEl, 'Restart');
      expect(plugin.restartCalls).toBe(1);
      expect(recordedNotices()).toContain('Remote SSH: daemon restarted');
    });

    it('Restart failure surfaces the error as a Notice', async () => {
      const plugin = fakePlugin({
        daemonStatus: { status: 'running', version: '1.2.3', capabilities: 7 },
        restartFails: true,
      });
      const tab = displayTab(plugin);
      await clickButton(tab.containerEl, 'Restart');
      expect(plugin.restartCalls).toBe(1);
      expect(recordedNotices().some(n => n.startsWith('Restart failed:'))).toBe(true);
    });
  });
});

// ─── local helpers ────────────────────────────────────────────────────

function findTextByDescContains(root: HTMLElement, descNeedle: string): TextComponent {
  for (const s of getSettingsIn(root)) {
    const desc = s.settingEl.querySelector('.setting-item-description')?.textContent ?? '';
    if (!desc.includes(descNeedle)) continue;
    const t = s.components.find((c): c is TextComponent => c.kind === 'text');
    if (t) return t;
  }
  throw new Error(`findTextByDescContains: no TextComponent under setting matching "${descNeedle}"`);
}

function findToggleByName(root: HTMLElement, nameNeedle: string): ToggleComponent {
  for (const s of getSettingsIn(root)) {
    const name = s.settingEl.querySelector('.setting-item-name')?.textContent ?? '';
    if (!name.includes(nameNeedle)) continue;
    const t = s.components.find((c): c is ToggleComponent => c.kind === 'toggle');
    if (t) return t;
  }
  throw new Error(`findToggleByName: no ToggleComponent under setting matching "${nameNeedle}"`);
}
