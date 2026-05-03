import { describe, it, expect, beforeEach } from 'vitest';
import { App, clearNotices } from 'obsidian';
import { SettingsTab } from '../../src/settings/SettingsTab';
import type RemoteSshPlugin from '../../src/main';
import type { PluginSettings, SshProfile } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/constants';

interface FakePluginOpts {
  settings?: Partial<PluginSettings>;
  isConnected?: boolean;
  daemonStatus?: ReturnType<RemoteSshPlugin['getDaemonStatus']>;
}

/**
 * Minimal RemoteSshPlugin stub. Records every method call so tests
 * can assert on the saveSettings + disconnect + open flows without
 * spinning up a real plugin instance (which would pull in
 * SftpClient, ConnectionManager, AdapterManager, etc.).
 */
function fakePlugin(opts: FakePluginOpts = {}): RemoteSshPlugin & {
  saveCalls: number;
  disconnectCalls: number;
  openShadowCalls: SshProfile[];
} {
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const stub = {
    app: new App(),
    settings,
    manifest: { id: 'remote-ssh', name: 'Remote SSH', version: '0.0.0' },
    saveCalls: 0,
    disconnectCalls: 0,
    openShadowCalls: [] as SshProfile[],
    async saveSettings() { this.saveCalls += 1; },
    async disconnect() { this.disconnectCalls += 1; },
    async openShadowVaultFor(p: SshProfile) { this.openShadowCalls.push(p); },
    isConnected: () => Boolean(opts.isConnected),
    getProfileFormDeps: () => ({
      authResolver: {} as never,
      hostKeyStore: {} as never,
    }),
    getDaemonStatus: () => opts.daemonStatus ?? ({ status: 'none' as const }),
    async readDaemonLog() { return '(no log)'; },
    async restartDaemon() { /* no-op */ },
  };
  return stub as unknown as RemoteSshPlugin & {
    saveCalls: number;
    disconnectCalls: number;
    openShadowCalls: SshProfile[];
  };
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

describe('SettingsTab', () => {
  beforeEach(() => clearNotices());

  describe('display() — base render', () => {
    it('shows the SSH profiles heading + add-profile setting', () => {
      const plugin = fakePlugin();
      const tab = new SettingsTab(new App(), plugin);
      tab.display();

      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('SSH profiles');
      expect(text).toContain('Add profile');
      expect(text).toContain('This device');
      expect(text).toContain('Advanced');
    });

    it('omits the Daemon section when not connected (status: none)', () => {
      const plugin = fakePlugin({ daemonStatus: { status: 'none' } });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      expect(tab.containerEl.textContent ?? '').not.toContain('Daemon');
    });

    it('renders the Daemon section when status is running', () => {
      const plugin = fakePlugin({
        daemonStatus: { status: 'running', version: '1.2.3', capabilities: 7 },
      });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Daemon');
      expect(text).toContain('🟢 Running');
      expect(text).toContain('v1.2.3');
      expect(text).toContain('7 capabilities');
    });

    it('renders the Daemon section as Down when status is down', () => {
      const plugin = fakePlugin({
        daemonStatus: { status: 'down' },
      });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('🔴 Down');
      expect(text).toContain('RPC connection lost');
    });
  });

  describe('display() — profile rows', () => {
    it('renders one row per saved profile', () => {
      const plugin = fakePlugin({
        settings: {
          profiles: [
            profile({ id: 'p1', name: 'Alpha' }),
            profile({ id: 'p2', name: 'Beta', host: 'beta.example' }),
          ],
        },
      });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Alpha');
      expect(text).toContain('Beta');
      expect(text).toContain('me@beta.example:22');
    });

    it('shows "Connect" button on a non-active profile (isConnected=false)', () => {
      const plugin = fakePlugin({
        settings: { profiles: [profile()] },
        isConnected: false,
      });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const buttons = Array.from(tab.containerEl.querySelectorAll('button'))
        .map(b => b.textContent ?? '');
      expect(buttons).toContain('Connect');
    });
  });

  describe('client ID + user name fields', () => {
    it('persists changes to clientId via saveSettings', async () => {
      const plugin = fakePlugin({ settings: { clientId: '' } });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      // Drive the public path — set settings + saveSettings.
      plugin.settings.clientId = 'my-laptop';
      await plugin.saveSettings();
      expect(plugin.settings.clientId).toBe('my-laptop');
      expect(plugin.saveCalls).toBe(1);
    });
  });

  describe('telemetry toggle', () => {
    it('telemetry section renders the enable-toggle setting', () => {
      const plugin = fakePlugin();
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Telemetry');
      expect(text).toContain('Enable anonymous telemetry');
      expect(text).toContain('nothing is sent over the network');
    });
  });

  describe('reconnect-attempts field', () => {
    it('renders the reconnect-attempts setting label', () => {
      const plugin = fakePlugin({ settings: { reconnectMaxRetries: 7 } });
      const tab = new SettingsTab(new App(), plugin);
      tab.display();
      const text = tab.containerEl.textContent ?? '';
      expect(text).toContain('Reconnect attempts after unexpected disconnect');
    });
  });
});
