import { Notice, Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { MobileSettingsTab } from './settings/MobileSettingsTab';

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
  remotePath: string;
  connectTimeoutMs: number;
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  transport?: 'sftp' | 'rpc';
};

type MobileVerificationIssue = {
  profileId: string;
  profileName: string;
  field: 'name' | 'host' | 'port' | 'username' | 'remotePath';
  message: string;
};

type MobileVerificationResult = {
  timestamp: string;
  totalProfiles: number;
  invalidProfiles: number;
  issues: MobileVerificationIssue[];
  warnings: string[];
};

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;
  private mobilePreviewMode = false;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: MobileProfile[] = [];

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
    const invalidProfileIds = new Set<string>();

    for (const p of profiles) {
      const profileName = p.name?.trim() || '(unnamed)';
      if (!p.name?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'name', message: 'Name is required' });
        invalidProfileIds.add(p.id);
      }
      if (!p.host?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'host', message: 'Host is required' });
        invalidProfileIds.add(p.id);
      }
      if (!p.username?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'username', message: 'Username is required' });
        invalidProfileIds.add(p.id);
      }
      if (!p.remotePath?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'remotePath', message: 'Remote path is required' });
        invalidProfileIds.add(p.id);
      }
      if (!Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        issues.push({ profileId: p.id, profileName, field: 'port', message: 'Port must be between 1 and 65535' });
        invalidProfileIds.add(p.id);
      }

      const key = `${p.username.trim()}@${p.host.trim()}:${p.port}:${p.remotePath.trim()}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    }

    for (const [key, count] of duplicateKeys.entries()) {
      if (count > 1) {
        warnings.push(`Duplicate endpoint+path detected (${count}x): ${key}`);
      }
    }

    const result: MobileVerificationResult = {
      timestamp,
      totalProfiles: profiles.length,
      invalidProfiles: invalidProfileIds.size,
      issues,
      warnings,
    };

    this.pushMobilePreviewLog(
      `Verification suite: total=${result.totalProfiles}, invalid=${result.invalidProfiles}, warnings=${result.warnings.length}`,
    );
    return result;
  }

  formatMobileVerificationReport(result: MobileVerificationResult): string {
    const lines: string[] = [];
    lines.push(`Mobile verification report @ ${result.timestamp}`);
    lines.push(`Profiles: total=${result.totalProfiles}, invalid=${result.invalidProfiles}`);
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

  async onload(): Promise<void> {
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

