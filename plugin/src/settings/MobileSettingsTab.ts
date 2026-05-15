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
    status: 'PASS' | 'WARN' | 'FAIL';
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
    status: 'PASS' | 'WARN' | 'FAIL';
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
  runMobileConnectionProbe: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    attempted: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    entries: Array<{
      profileId: string;
      profileName: string;
      target: string;
      outcome: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
      detail: string;
      latencyMs?: number;
    }>;
    note: string;
  }>;
  formatMobileConnectionProbeReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    attempted: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    entries: Array<{
      profileId: string;
      profileName: string;
      target: string;
      outcome: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
      detail: string;
      latencyMs?: number;
    }>;
    note: string;
  }) => string;
  runMobileSshConnectTest: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    attempted: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    note: string;
    attempts: Array<{
      profileId: string;
      profileName: string;
      target: string;
      status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
      detail: string;
      latencyMs?: number;
    }>;
  }>;
  formatMobileSshConnectReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    attempted: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    note: string;
    attempts: Array<{
      profileId: string;
      profileName: string;
      target: string;
      status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
      detail: string;
      latencyMs?: number;
    }>;
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
          if (result.status === 'PASS') {
            new Notice('Remote SSH: verification passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice(`Remote SSH: verification passed with ${result.warnings.length} warnings`);
            return;
          }
          new Notice(`Remote SSH: verification failed (${result.invalidProfiles} invalid profiles)`);
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(() => {
          const result = this.pluginRef.runMobileVerification();
          const report = this.pluginRef.formatMobileVerificationReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: verification report copied');
        }));

    new Setting(containerEl)
      .setName('Connection probe (best-effort)')
      .setDesc('Probe host:port reachability from mobile via HTTP HEAD. This is not an SSH handshake test.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileConnectionProbe();
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
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileConnectionProbe();
          const report = this.pluginRef.formatMobileConnectionProbeReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: connection probe report copied');
        }));

    new Setting(containerEl)
      .setName('SSH connect test (experimental)')
      .setDesc('Attempt a real SSH connect using the first configured profile. Expect auth failures until credentials are added.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileSshConnectTest();
          if (result.attempted === 0) {
            new Notice('Remote SSH: SSH connect test skipped (no profiles configured)');
            return;
          }
          if (result.status === 'PASS') {
            new Notice('Remote SSH: SSH connect test passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice('Remote SSH: SSH connect test warning (likely missing credentials)');
            return;
          }
          new Notice('Remote SSH: SSH connect test failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileSshConnectTest();
          const report = this.pluginRef.formatMobileSshConnectReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: SSH connect test report copied');
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

