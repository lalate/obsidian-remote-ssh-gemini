import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

type MobilePreviewPlugin = Plugin & {
  getMobilePreviewLogs: () => string[];
  getMobileProfiles: () => Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
  }>;
  addMobileProfile: () => Promise<void>;
  updateMobileProfile: (id: string, patch: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    remotePath?: string;
  }) => Promise<void>;
  removeMobileProfile: (id: string) => Promise<void>;
  runMobileVerification: () => {
    timestamp: string;
    totalProfiles: number;
    invalidProfiles: number;
    issues: Array<{
      profileId: string;
      profileName: string;
      field: 'name' | 'host' | 'port' | 'username' | 'remotePath';
      message: string;
    }>;
    warnings: string[];
  };
  formatMobileVerificationReport: (result: {
    timestamp: string;
    totalProfiles: number;
    invalidProfiles: number;
    issues: Array<{
      profileId: string;
      profileName: string;
      field: 'name' | 'host' | 'port' | 'username' | 'remotePath';
      message: string;
    }>;
    warnings: string[];
  }) => string;
  clearMobilePreviewLogs: () => Promise<void>;
};

export class MobileSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly pluginRef: MobilePreviewPlugin) {
    super(app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Mobile preview')
      .setHeading();

    containerEl.createEl('p', {
      text:
        'Desktop runtime is gated in this phase. This panel keeps local logs so ' +
        'you can report activation and runtime behavior while mobile support is being built out.',
      cls: 'setting-item-description',
    });

    const warn = containerEl.createDiv({ cls: 'setting-item-description' });
    warn.createEl('strong', { text: 'Current mobile limitations' });
    const ul = warn.createEl('ul');
    ul.createEl('li', { text: 'SSH connect/disconnect runtime is not enabled yet.' });
    ul.createEl('li', { text: 'Remote terminal and daemon controls are desktop-only in this phase.' });
    ul.createEl('li', { text: 'Use profile validation + logs for preflight checks before M5.' });

    new Setting(containerEl)
      .setName('Profiles (preview)')
      .setHeading();

    containerEl.createEl('p', {
      text: 'You can create and edit minimum required profile fields on mobile in this phase.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Add profile')
      .addButton(btn => btn
        .setButtonText('Add')
        .setCta()
        .onClick(async () => {
          await this.pluginRef.addMobileProfile();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Verification suite')
      .setDesc('Run a deterministic preflight check and copy a report for issue sharing.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(() => {
          const result = this.pluginRef.runMobileVerification();
          if (result.totalProfiles === 0) {
            new Notice('Remote SSH: no profiles configured yet');
            return;
          }
          if (result.invalidProfiles === 0) {
            new Notice('Remote SSH: verification passed');
            return;
          }
          new Notice(`Remote SSH: verification found ${result.invalidProfiles} invalid profiles`);
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(() => {
          const result = this.pluginRef.runMobileVerification();
          const report = this.pluginRef.formatMobileVerificationReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: verification report copied');
        }));

    const profiles = this.pluginRef.getMobileProfiles();
    if (profiles.length === 0) {
      containerEl.createEl('p', {
        text: 'No profiles yet. Tap Add to create one.',
        cls: 'setting-item-description',
      });
    }

    for (const p of profiles) {
      new Setting(containerEl)
        .setName(`Profile: ${p.name || '(unnamed)'}`)
        .setDesc(`${p.username || '?'}@${p.host || '?'}:${p.port} -> ${p.remotePath || '?'}`)
        .addButton(btn => btn
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            await this.pluginRef.removeMobileProfile(p.id);
            this.display();
          }));

      new Setting(containerEl)
        .setName('Name')
        .addText(t => t
          .setValue(p.name)
          .onChange(async v => {
            await this.pluginRef.updateMobileProfile(p.id, { name: v });
          }));

      new Setting(containerEl)
        .setName('Host')
        .addText(t => t
          .setValue(p.host)
          .onChange(async v => {
            await this.pluginRef.updateMobileProfile(p.id, { host: v.trim() });
          }));

      new Setting(containerEl)
        .setName('Port')
        .addText(t => t
          .setValue(String(p.port))
          .onChange(async v => {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n) && n > 0 && n <= 65535) {
              await this.pluginRef.updateMobileProfile(p.id, { port: n });
            }
          }));

      new Setting(containerEl)
        .setName('Username')
        .addText(t => t
          .setValue(p.username)
          .onChange(async v => {
            await this.pluginRef.updateMobileProfile(p.id, { username: v.trim() });
          }));

      new Setting(containerEl)
        .setName('Remote path')
        .addText(t => t
          .setValue(p.remotePath)
          .onChange(async v => {
            await this.pluginRef.updateMobileProfile(p.id, { remotePath: v.trim() });
          }));
    }

    const logs = this.pluginRef.getMobilePreviewLogs();
    const summary = logs.length === 0 ? 'No logs yet' : `${logs.length} log entries`;

    new Setting(containerEl)
      .setName('Preview logs')
      .setDesc(`${summary}. Each line includes a session id for run-to-run traceability.`)
      .addButton(btn => btn
        .setButtonText('Copy logs')
        .setCta()
        .onClick(() => {
          const body = logs.length === 0 ? '(no logs)' : logs.join('\n');
          void navigator.clipboard.writeText(body);
          new Notice('Remote SSH: preview logs copied');
        }))
      .addButton(btn => btn
        .setButtonText('Clear')
        .setWarning()
        .onClick(async () => {
          await this.pluginRef.clearMobilePreviewLogs();
          this.display();
          new Notice('Remote SSH: preview logs cleared');
        }));

    if (logs.length > 0) {
      const pre = containerEl.createEl('pre', { cls: 'remote-ssh-log-pre' });
      pre.textContent = logs.join('\n');
    }
  }
}
