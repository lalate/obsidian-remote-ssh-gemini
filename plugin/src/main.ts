import { Notice, Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { MobileSettingsTab } from './settings/MobileSettingsTab';

type DesktopPlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
};

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;
  private mobilePreviewMode = false;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: Array<{
    id?: string;
    name?: string;
    host?: string;
    username?: string;
    remotePath?: string;
  }> = [];

  private pushMobilePreviewLog(message: string): void {
    const line = `[${new Date().toISOString()}] [session:${this.mobileSessionId || 'n/a'}] ${message}`;
    this.mobilePreviewLogs.push(line);
    if (this.mobilePreviewLogs.length > 200) {
      this.mobilePreviewLogs.shift();
    }
    console.info(`[Remote SSH][mobile-preview] ${message}`);
    void this.persistMobilePreviewLogs();
  }

  private async persistMobilePreviewLogs(): Promise<void> {
    if (!this.mobilePreviewMode) return;
    const saved = (await this.loadData()) as Record<string, unknown> | null;
    await this.saveData({
      ...(saved ?? {}),
      mobilePreviewLogs: this.mobilePreviewLogs,
    });
  }

  getMobilePreviewLogs(): string[] {
    return [...this.mobilePreviewLogs];
  }

  async clearMobilePreviewLogs(): Promise<void> {
    this.mobilePreviewLogs = [];
    await this.persistMobilePreviewLogs();
  }

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as {
      mobilePreviewLogs?: string[];
      profiles?: Array<{
        id?: string;
        name?: string;
        host?: string;
        username?: string;
        remotePath?: string;
      }>;
    } | null;
    this.mobileSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.mobilePreviewLogs = Array.isArray(saved?.mobilePreviewLogs)
      ? saved.mobilePreviewLogs.filter((v): v is string => typeof v === 'string').slice(-200)
      : [];
    this.mobileProfiles = Array.isArray(saved?.profiles)
      ? saved.profiles
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
          const profiles = this.mobileProfiles;
          if (!Array.isArray(profiles) || profiles.length === 0) {
            this.pushMobilePreviewLog('Profile validation: no profiles configured');
            new Notice('Remote SSH: no profiles configured yet');
            return;
          }
          let invalid = 0;
          for (const p of profiles) {
            const ok = Boolean(
              p?.name?.trim()
              && p?.host?.trim()
              && p?.username?.trim()
              && p?.remotePath?.trim(),
            );
            if (!ok) invalid += 1;
          }
          this.pushMobilePreviewLog(
            `Profile validation: total=${profiles.length}, invalid=${invalid}`,
          );
          if (invalid === 0) {
            new Notice(`Remote SSH: profile settings look good (${profiles.length} profiles)`);
            return;
          }
          new Notice(`Remote SSH: ${invalid}/${profiles.length} profiles have missing required fields`);
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

