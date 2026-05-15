import { Notice, Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { MobileSettingsTab } from './settings/MobileSettingsTab';
import type { SshProfile } from './types';

type DesktopPlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
};

type MobileProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey' | 'agent';
  passwordRef?: string;
  privateKeyPath?: string;
  passphraseRef?: string;
  agentSocket?: string;
  hostKeyFingerprint?: string;
  remotePath: string;
  connectTimeoutMs: number;
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  transport?: 'sftp' | 'rpc';
  jumpHost?: {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey' | 'agent';
    privateKeyPath?: string;
    passwordRef?: string;
  };
};

type MobileVerificationIssue = {
  profileId: string;
  profileName: string;
  field: 'name' | 'host' | 'port' | 'username' | 'remotePath';
  message: string;
};

type MobileVerificationResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  totalProfiles: number;
  invalidProfiles: number;
  issues: MobileVerificationIssue[];
  warnings: string[];
};

type MobileConnectionProbeEntry = {
  profileId: string;
  profileName: string;
  target: string;
  outcome: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  latencyMs?: number;
};

type MobileConnectionProbeResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  attempted: number;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  entries: MobileConnectionProbeEntry[];
  note: string;
};

type MobileSshConnectAttempt = {
  profileId: string;
  profileName: string;
  target: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  latencyMs?: number;
};

type MobileSshConnectResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  attempted: number;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  note: string;
  attempts: MobileSshConnectAttempt[];
};

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;
  private mobilePreviewMode = false;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: MobileProfile[] = [];

  private ensureBufferGlobal(): void {
    // The mobile runtime may not expose Node's Buffer global. We no longer
    // import the buffer module eagerly because that can break plugin loading.
    // Instead, keep the runtime untouched here and let SSH test paths bail out
    // with a clear warning when Buffer is unavailable.
  }

  private hasBufferGlobal(): boolean {
    return typeof (globalThis as { Buffer?: unknown }).Buffer !== 'undefined';
  }

  private getMobileReportMetaLine(): string {
    const pluginVersion = this.manifest?.version ?? 'unknown';
    const appVersion = (this.app as App & { version?: string }).version ?? 'unknown';
    const platform = Platform.isMobileApp ? 'mobile' : 'desktop';
    return `Meta: plugin=${pluginVersion}, obsidian=${appVersion}, platform=${platform}`;
  }

  private createDefaultMobileProfile(): MobileProfile {
    const id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name: 'New profile',
      host: '',
      port: 22,
      username: '',
      authMethod: 'password',
      remotePath: '',
      connectTimeoutMs: 15000,
      keepaliveIntervalMs: 15000,
      keepaliveCountMax: 3,
      transport: 'sftp',
    };
  }

  private pushMobilePreviewLog(message: string): void {
    const line = `[${new Date().toISOString()}] [session:${this.mobileSessionId || 'n/a'}] ${message}`;
    this.mobilePreviewLogs.push(line);
    if (this.mobilePreviewLogs.length > 200) {
      this.mobilePreviewLogs.shift();
    }
    console.info(`[Remote SSH][mobile-preview] ${message}`);
    void this.persistMobilePreviewState();
  }

  private async persistMobilePreviewState(): Promise<void> {
    if (!this.mobilePreviewMode) return;
    const saved = (await this.loadData()) as Record<string, unknown> | null;
    await this.saveData({
      ...(saved ?? {}),
      mobilePreviewLogs: this.mobilePreviewLogs,
      profiles: this.mobileProfiles,
    });
  }

  getMobilePreviewLogs(): string[] {
    return [...this.mobilePreviewLogs];
  }

  getMobileProfiles(): MobileProfile[] {
    return this.mobileProfiles.map(p => ({ ...p }));
  }

  async addMobileProfile(): Promise<void> {
    this.mobileProfiles.push(this.createDefaultMobileProfile());
    this.pushMobilePreviewLog(`Profile added: total=${this.mobileProfiles.length}`);
    await this.persistMobilePreviewState();
  }

  async updateMobileProfile(id: string, patch: Partial<MobileProfile>): Promise<void> {
    const idx = this.mobileProfiles.findIndex(p => p.id === id);
    if (idx < 0) return;
    this.mobileProfiles[idx] = { ...this.mobileProfiles[idx], ...patch };
    await this.persistMobilePreviewState();
  }

  async removeMobileProfile(id: string): Promise<void> {
    this.mobileProfiles = this.mobileProfiles.filter(p => p.id !== id);
    this.pushMobilePreviewLog(`Profile removed: total=${this.mobileProfiles.length}`);
    await this.persistMobilePreviewState();
  }

  async clearMobilePreviewLogs(): Promise<void> {
    this.mobilePreviewLogs = [];
    await this.persistMobilePreviewState();
  }

  runMobileVerification(): MobileVerificationResult {
    const timestamp = new Date().toISOString();
    const issues: MobileVerificationIssue[] = [];
    const warnings: string[] = [];
    const profiles = this.mobileProfiles;
    const duplicateKeys = new Map<string, number>();
    const duplicateNames = new Map<string, number>();
    const invalidProfileIds = new Set<string>();

    for (const p of profiles) {
      const profileName = p.name?.trim() || '(unnamed)';
      const host = p.host?.trim() ?? '';
      const username = p.username?.trim() ?? '';
      const remotePath = p.remotePath?.trim() ?? '';

      if (!p.name?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'name', message: 'Name is required' });
        invalidProfileIds.add(p.id);
      }
      if (!host) {
        issues.push({ profileId: p.id, profileName, field: 'host', message: 'Host is required' });
        invalidProfileIds.add(p.id);
      }
      if (!username) {
        issues.push({ profileId: p.id, profileName, field: 'username', message: 'Username is required' });
        invalidProfileIds.add(p.id);
      }
      if (!remotePath) {
        issues.push({ profileId: p.id, profileName, field: 'remotePath', message: 'Remote path is required' });
        invalidProfileIds.add(p.id);
      }
      if (!Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        issues.push({ profileId: p.id, profileName, field: 'port', message: 'Port must be between 1 and 65535' });
        invalidProfileIds.add(p.id);
      }

      if (host.includes(' ')) {
        warnings.push(`${profileName}: host contains whitespace`);
      }
      if (host === 'localhost' || host === '127.0.0.1') {
        warnings.push(`${profileName}: host points to local device (${host}); verify this is intended`);
      }
      if (remotePath && !remotePath.startsWith('/')) {
        warnings.push(`${profileName}: remote path is not absolute (${remotePath})`);
      }
      if (remotePath.endsWith('/')) {
        warnings.push(`${profileName}: remote path has trailing slash (${remotePath})`);
      }

      duplicateNames.set(profileName, (duplicateNames.get(profileName) ?? 0) + 1);
      const key = `${username}@${host}:${p.port}:${remotePath}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    }

    for (const [name, count] of duplicateNames.entries()) {
      if (name !== '(unnamed)' && count > 1) {
        warnings.push(`Duplicate profile name detected (${count}x): ${name}`);
      }
    }
    for (const [key, count] of duplicateKeys.entries()) {
      if (count > 1) {
        warnings.push(`Duplicate endpoint+path detected (${count}x): ${key}`);
      }
    }

    const status: 'PASS' | 'WARN' | 'FAIL' =
      invalidProfileIds.size > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS');

    const result: MobileVerificationResult = {
      timestamp,
      status,
      totalProfiles: profiles.length,
      invalidProfiles: invalidProfileIds.size,
      issues,
      warnings,
    };

    this.pushMobilePreviewLog(
      `Verification suite: status=${result.status}, total=${result.totalProfiles}, invalid=${result.invalidProfiles}, warnings=${result.warnings.length}`,
    );
    return result;
  }

  formatMobileVerificationReport(result: MobileVerificationResult): string {
    const lines: string[] = [];
    lines.push(`Mobile verification report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Profiles: total=${result.totalProfiles}, invalid=${result.invalidProfiles}, warnings=${result.warnings.length}`);
    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      for (const w of result.warnings) lines.push(`- ${w}`);
    }
    if (result.issues.length > 0) {
      lines.push('Issues:');
      for (const i of result.issues) {
        lines.push(`- ${i.profileName} (${i.profileId}) [${i.field}] ${i.message}`);
      }
    } else {
      lines.push('Issues: none');
    }
    return lines.join('\n');
  }

  private classifyProbeError(message: string): { outcome: 'WARN' | 'FAIL'; detail: string } {
    const m = message.toLowerCase();
    if (m.includes('timed out') || m.includes('timeout')) {
      return { outcome: 'FAIL', detail: 'timeout while reaching host/port' };
    }
    if (m.includes('ssl') || m.includes('certificate') || m.includes('handshake')) {
      return {
        outcome: 'WARN',
        detail: 'host reachable but TLS/HTTP mismatch (expected on SSH port in many cases)',
      };
    }
    if (m.includes('fetch') || m.includes('network') || m.includes('dns')) {
      return { outcome: 'FAIL', detail: 'network unreachable or host not resolvable from this device' };
    }
    return { outcome: 'WARN', detail: `indeterminate response: ${message}` };
  }

  async runMobileConnectionProbe(): Promise<MobileConnectionProbeResult> {
    const timestamp = new Date().toISOString();
    const entries: MobileConnectionProbeEntry[] = [];
    const note =
      'Best-effort probe via HTTP(S) request to host:port. This is not an SSH handshake test, '
      + 'but helps detect obvious reachability problems from mobile.';

    for (const p of this.mobileProfiles) {
      const profileName = p.name?.trim() || '(unnamed)';
      const host = p.host?.trim() ?? '';
      const remotePath = p.remotePath?.trim() ?? '';
      const username = p.username?.trim() ?? '';
      const target = `${host}:${p.port}`;

      if (!host || !username || !remotePath || !Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: 'SKIP',
          detail: 'profile has missing/invalid required fields',
        });
        continue;
      }

      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        // HTTP probe only: quick signal that host:port is reachable from mobile.
        await fetch(`http://${host}:${p.port}/`, {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store',
        });
        const latencyMs = Date.now() - started;
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: 'WARN',
          detail: 'port responded to HTTP probe (reachable, but service may not be SSH)',
          latencyMs,
        });
      } catch (e) {
        const latencyMs = Date.now() - started;
        const raw = e instanceof Error ? e.message : String(e);
        const classified = this.classifyProbeError(raw);
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: classified.outcome,
          detail: classified.detail,
          latencyMs,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    const attempted = entries.filter(e => e.outcome !== 'SKIP').length;
    const pass = entries.filter(e => e.outcome === 'PASS').length;
    const warn = entries.filter(e => e.outcome === 'WARN').length;
    const fail = entries.filter(e => e.outcome === 'FAIL').length;
    const skip = entries.filter(e => e.outcome === 'SKIP').length;
    const status: 'PASS' | 'WARN' | 'FAIL' =
      fail > 0 ? 'FAIL' : (warn > 0 ? 'WARN' : 'PASS');

    const result: MobileConnectionProbeResult = {
      timestamp,
      status,
      attempted,
      pass,
      warn,
      fail,
      skip,
      entries,
      note,
    };

    this.pushMobilePreviewLog(
      `Connection probe: status=${status}, attempted=${attempted}, pass=${pass}, warn=${warn}, fail=${fail}, skip=${skip}`,
    );

    return result;
  }

  formatMobileConnectionProbeReport(result: MobileConnectionProbeResult): string {
    const lines: string[] = [];
    lines.push(`Mobile connection probe report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(
      `Summary: attempted=${result.attempted}, pass=${result.pass}, warn=${result.warn}, fail=${result.fail}, skip=${result.skip}`,
    );
    lines.push(`Note: ${result.note}`);
    lines.push('Entries:');
    for (const e of result.entries) {
      const latency = typeof e.latencyMs === 'number' ? `, latency=${e.latencyMs}ms` : '';
      lines.push(`- ${e.profileName} (${e.target}) -> ${e.outcome}: ${e.detail}${latency}`);
    }
    if (result.entries.length === 0) {
      lines.push('- (no profiles)');
    }
    return lines.join('\n');
  }

  private toSshProfile(profile: MobileProfile): SshProfile {
    return {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      passwordRef: profile.passwordRef,
      privateKeyPath: profile.privateKeyPath,
      passphraseRef: profile.passphraseRef,
      agentSocket: profile.agentSocket,
      hostKeyFingerprint: profile.hostKeyFingerprint,
      remotePath: profile.remotePath,
      connectTimeoutMs: profile.connectTimeoutMs,
      keepaliveIntervalMs: profile.keepaliveIntervalMs,
      keepaliveCountMax: profile.keepaliveCountMax,
      transport: profile.transport,
      jumpHost: profile.jumpHost,
    };
  }

  async runMobileSshConnectTest(): Promise<MobileSshConnectResult> {
    const timestamp = new Date().toISOString();
    const note = 'Attempts a real SSH connect through SftpClient using the first configured mobile profile.';
    const attempts: MobileSshConnectAttempt[] = [];
    const profile = this.mobileProfiles[0];

    if (!this.hasBufferGlobal()) {
      const result: MobileSshConnectResult = {
        timestamp,
        status: 'WARN',
        attempted: 0,
        pass: 0,
        warn: 1,
        fail: 0,
        skip: 1,
        note,
        attempts: [
          {
            profileId: '(none)',
            profileName: '(none)',
            target: '(none)',
            status: 'WARN',
            detail: 'Buffer global is unavailable in this runtime; SSH connect test cannot start',
          },
        ],
      };
      this.pushMobilePreviewLog('SSH connect test: skipped (Buffer global unavailable)');
      return result;
    }

    if (!profile) {
      const result: MobileSshConnectResult = {
        timestamp,
        status: 'WARN',
        attempted: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        skip: 1,
        note,
        attempts: [
          {
            profileId: '(none)',
            profileName: '(none)',
            target: '(none)',
            status: 'SKIP',
            detail: 'no profiles configured',
          },
        ],
      };
      this.pushMobilePreviewLog('SSH connect test: skipped (no profiles configured)');
      return result;
    }

    const target = `${profile.host}:${profile.port}`;
    const started = Date.now();
    try {
      const [{ SftpClient }, { AuthResolver }, { HostKeyStore }, { SecretStore }] = await Promise.all([
        import('./ssh/SftpClient'),
        import('./ssh/AuthResolver'),
        import('./ssh/HostKeyStore'),
        import('./ssh/SecretStore'),
      ]);

      const secretStore = new SecretStore();
      const authResolver = new AuthResolver(secretStore);
      const hostKeyStore = new HostKeyStore();
      const client = new SftpClient(authResolver, hostKeyStore);
      const sshProfile = this.toSshProfile(profile);

      await client.connect(sshProfile);
      await client.disconnect();

      const latencyMs = Date.now() - started;
      attempts.push({
        profileId: profile.id,
        profileName: profile.name,
        target,
        status: 'PASS',
        detail: 'SSH connect succeeded and disconnected cleanly',
        latencyMs,
      });

      const result: MobileSshConnectResult = {
        timestamp,
        status: 'PASS',
        attempted: 1,
        pass: 1,
        warn: 0,
        fail: 0,
        skip: 0,
        note,
        attempts,
      };
      this.pushMobilePreviewLog(`SSH connect test: PASS (${profile.name})`);
      return result;
    } catch (e) {
      const latencyMs = Date.now() - started;
      const message = e instanceof Error ? e.message : String(e);
      const lower = message.toLowerCase();
      const status: 'WARN' | 'FAIL' =
        lower.includes('no password stored') ||
        lower.includes('no private key path') ||
        lower.includes('ssh agent requested')
          ? 'WARN'
          : 'FAIL';
      attempts.push({
        profileId: profile.id,
        profileName: profile.name,
        target,
        status,
        detail: message,
        latencyMs,
      });

      const result: MobileSshConnectResult = {
        timestamp,
        status,
        attempted: 1,
        pass: 0,
        warn: status === 'WARN' ? 1 : 0,
        fail: status === 'FAIL' ? 1 : 0,
        skip: 0,
        note,
        attempts,
      };
      this.pushMobilePreviewLog(`SSH connect test: ${status} (${profile.name}) — ${message}`);
      return result;
    }
  }

  formatMobileSshConnectReport(result: MobileSshConnectResult): string {
    const lines: string[] = [];
    lines.push(`Mobile SSH connect test report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(
      `Summary: attempted=${result.attempted}, pass=${result.pass}, warn=${result.warn}, fail=${result.fail}, skip=${result.skip}`,
    );
    lines.push(`Note: ${result.note}`);
    lines.push('Attempts:');
    for (const a of result.attempts) {
      const latency = typeof a.latencyMs === 'number' ? `, latency=${a.latencyMs}ms` : '';
      lines.push(`- ${a.profileName} (${a.target}) -> ${a.status}: ${a.detail}${latency}`);
    }
    return lines.join('\n');
  }

  async onload(): Promise<void> {
    this.ensureBufferGlobal();
    const saved = (await this.loadData()) as {
      mobilePreviewLogs?: string[];
      profiles?: Array<Partial<MobileProfile>>;
    } | null;
    this.mobileSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.mobilePreviewLogs = Array.isArray(saved?.mobilePreviewLogs)
      ? saved.mobilePreviewLogs.filter((v): v is string => typeof v === 'string').slice(-200)
      : [];
    this.mobileProfiles = Array.isArray(saved?.profiles)
      ? saved.profiles
        .filter((v): v is Partial<MobileProfile> => typeof v === 'object' && v !== null)
        .map(v => ({
          ...this.createDefaultMobileProfile(),
          ...v,
          id: typeof v.id === 'string' && v.id.length > 0 ? v.id : this.createDefaultMobileProfile().id,
          port: Number.isFinite(v.port) ? Number(v.port) : 22,
          authMethod:
            v.authMethod === 'privateKey' || v.authMethod === 'agent' || v.authMethod === 'password'
              ? v.authMethod
              : 'password',
        }))
      : [];

    if (Platform.isMobileApp) {
      this.mobilePreviewMode = true;
      this.addSettingTab(new MobileSettingsTab(this.app, this));
      this.pushMobilePreviewLog('Activated mobile preview mode');
      this.addCommand({
        id: 'mobile-status',
        name: 'Mobile status (preview)',
        callback: () => {
          this.pushMobilePreviewLog('Executed command: mobile-status');
          new Notice(
            'Remote SSH: mobile preview mode. Activation succeeded; desktop runtime is gated in this phase.',
          );
        },
      });
      this.addCommand({
        id: 'mobile-copy-preview-logs',
        name: 'Mobile: copy preview logs',
        callback: () => {
          const body = this.mobilePreviewLogs.length === 0
            ? '(no logs)'
            : this.mobilePreviewLogs.join('\n');
          void navigator.clipboard.writeText(body);
          this.pushMobilePreviewLog('Executed command: mobile-copy-preview-logs');
          new Notice('Remote SSH: preview logs copied');
        },
      });
      this.addCommand({
        id: 'mobile-validate-profiles',
        name: 'Mobile: validate profile settings',
        callback: () => {
          const result = this.runMobileVerification();
          if (result.totalProfiles === 0) {
            this.pushMobilePreviewLog('Profile validation: no profiles configured');
            new Notice('Remote SSH: no profiles configured yet');
            return;
          }
          this.pushMobilePreviewLog(`Profile validation: total=${result.totalProfiles}, invalid=${result.invalidProfiles}`);
          if (result.invalidProfiles === 0) {
            new Notice(`Remote SSH: profile settings look good (${result.totalProfiles} profiles)`);
            return;
          }
          new Notice(`Remote SSH: ${result.invalidProfiles}/${result.totalProfiles} profiles have invalid fields`);
        },
      });
      this.addCommand({
        id: 'mobile-copy-verification-report',
        name: 'Mobile: copy verification report',
        callback: () => {
          const result = this.runMobileVerification();
          const report = this.formatMobileVerificationReport(result);
          void navigator.clipboard.writeText(report);
          this.pushMobilePreviewLog('Executed command: mobile-copy-verification-report');
          new Notice('Remote SSH: verification report copied');
        },
      });
      this.addCommand({
        id: 'mobile-run-connection-probe',
        name: 'Mobile: run connection probe',
        callback: async () => {
          const result = await this.runMobileConnectionProbe();
          if (result.attempted === 0) {
            new Notice('Remote SSH: connection probe skipped (no valid profiles)');
            return;
          }
          if (result.status === 'PASS') {
            new Notice('Remote SSH: connection probe passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice(`Remote SSH: connection probe completed with ${result.warn} warnings`);
            return;
          }
          new Notice(`Remote SSH: connection probe failed (${result.fail} failures)`);
        },
      });
      this.addCommand({
        id: 'mobile-copy-connection-probe-report',
        name: 'Mobile: copy connection probe report',
        callback: async () => {
          const result = await this.runMobileConnectionProbe();
          const report = this.formatMobileConnectionProbeReport(result);
          void navigator.clipboard.writeText(report);
          this.pushMobilePreviewLog('Executed command: mobile-copy-connection-probe-report');
          new Notice('Remote SSH: connection probe report copied');
        },
      });
      new Notice('Remote SSH: mobile preview mode enabled');
      return;
    }

    const mod = await import('./main.desktop');
    const DesktopPluginClass = mod.default as new (app: App, manifest: PluginManifest) => DesktopPlugin;
    this.desktopDelegate = new DesktopPluginClass(this.app, this.manifest);
    await this.desktopDelegate.onload();
  }

  onunload(): void {
    if (this.mobilePreviewMode) {
      this.pushMobilePreviewLog('Unloaded mobile preview mode');
      return;
    }
    this.desktopDelegate?.onunload();
  }
}

