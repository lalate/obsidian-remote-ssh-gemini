import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

type MobilePreviewPlugin = Plugin & {
  getMobilePreviewLogs: () => string[];
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
