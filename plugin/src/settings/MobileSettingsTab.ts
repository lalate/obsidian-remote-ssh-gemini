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
    transport?: 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws';
    relayBaseUrl?: string;
    relayAuthToken?: string;
    relayRpcUsername?: string;
    relayRpcPassword?: string;
    wsHost?: string;
    wsPort?: number;
    wsToken?: string;
  }>;
  getMobileRelayConfig: () => {
    endpoint: string;
    authToken?: string;
    rpcUsername?: string;
    rpcPassword?: string;
  };
  updateMobileRelayConfig: (patch: {
    endpoint?: string;
    authToken?: string;
    rpcUsername?: string;
    rpcPassword?: string;
  }) => Promise<void>;
  addMobileProfile: () => Promise<void>;
  updateMobileProfile: (id: string, patch: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    remotePath?: string;
    transport?: 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws';
    relayBaseUrl?: string;
    relayAuthToken?: string;
    relayRpcUsername?: string;
    relayRpcPassword?: string;
    wsHost?: string;
    wsPort?: number;
    wsToken?: string;
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
  runMobileRelayProbe: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    latencyMs?: number;
    httpStatus?: number;
    detail: string;
    note: string;
  }>;
  formatMobileRelayProbeReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    latencyMs?: number;
    httpStatus?: number;
    detail: string;
    note: string;
  }) => string;
  runMobileRelayConnectTest: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    latencyMs?: number;
    httpStatus?: number;
    code?: string;
    sessionId?: string;
    streamUrl?: string;
    detail: string;
    note: string;
  }>;
  formatMobileRelayConnectReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    latencyMs?: number;
    httpStatus?: number;
    code?: string;
    sessionId?: string;
    streamUrl?: string;
    detail: string;
    note: string;
  }) => string;
  runMobileRelayStreamTest: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    sessionId?: string;
    streamUrl?: string;
    relayCode?: string;
    latencyMs?: number;
    detail: string;
    note: string;
  }>;
  formatMobileRelayStreamReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    sessionId?: string;
    streamUrl?: string;
    relayCode?: string;
    latencyMs?: number;
    detail: string;
    note: string;
  }) => string;
  runMobileRelayRpcTest: () => Promise<{
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    sessionId?: string;
    streamUrl?: string;
    relayCode?: string;
    latencyMs?: number;
    serverName?: string;
    serverVersion?: string;
    fsPath?: string;
    detail: string;
    note: string;
  }>;
  formatMobileRelayRpcReport: (result: {
    timestamp: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    endpoint: string;
    sessionId?: string;
    streamUrl?: string;
    relayCode?: string;
    latencyMs?: number;
    serverName?: string;
    serverVersion?: string;
    fsPath?: string;
    detail: string;
    note: string;
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
        'Mobile profiles support relay-rpc (via relay server) and direct-ws (via Tailscale + Go daemon). ' +
        'This panel keeps local logs so you can validate runtime behavior.',
      cls: 'setting-item-description',
    });

    const warn = containerEl.createDiv({ cls: 'setting-item-description' });
    warn.createEl('strong', { text: 'Current mobile limitations' });
    const ul = warn.createEl('ul');
    ul.createEl('li', { text: 'Direct SSH on mobile depends on runtime Node API availability.' });
    ul.createEl('li', { text: 'Remote terminal and daemon controls are desktop-only in this phase.' });
    ul.createEl('li', { text: 'For desktop-equivalent path, set transport=relay-rpc or direct-ws per profile.' });

    new Setting(containerEl)
      .setName('Profiles (preview)')
      .setHeading();

    containerEl.createEl('p', {
      text: 'You can create and edit desktop-equivalent profile fields (transport + relay credentials included).',
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
      .setName('Relay endpoint (mobile path)')
      .setHeading();

    containerEl.createEl('p', {
      text: 'Use a relay endpoint from mobile. Direct SSH is unavailable on this runtime.',
      cls: 'setting-item-description',
    });

    const relay = this.pluginRef.getMobileRelayConfig();

    new Setting(containerEl)
      .setName('Relay endpoint URL')
      .setDesc('Example: https://relay.example.com/healthz')
      .addText(t => t
        .setPlaceholder('https://relay.example.com/healthz')
        .setValue(relay.endpoint ?? '')
        .onChange(async v => {
          await this.pluginRef.updateMobileRelayConfig({ endpoint: v.trim() });
        }));

    new Setting(containerEl)
      .setName('Relay bearer token (optional)')
      .setDesc('Used only for relay probe authorization header.')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setValue(relay.authToken ?? '');
        t.onChange(async v => {
          await this.pluginRef.updateMobileRelayConfig({ authToken: v.trim() });
        });
      });

    new Setting(containerEl)
      .setName('Relay RPC username')
      .setDesc('JSON-RPC auth username used for relay stream handshake. Default fallback: admin')
      .addText(t => t
        .setPlaceholder('admin')
        .setValue(relay.rpcUsername ?? '')
        .onChange(async v => {
          await this.pluginRef.updateMobileRelayConfig({ rpcUsername: v.trim() });
        }));

    new Setting(containerEl)
      .setName('Relay RPC password')
      .setDesc('JSON-RPC auth password used for relay stream handshake. Default fallback: password')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setValue(relay.rpcPassword ?? '');
        t.onChange(async v => {
          await this.pluginRef.updateMobileRelayConfig({ rpcPassword: v.trim() });
        });
      });

    new Setting(containerEl)
      .setName('AI Chat (iOS)')
      .setHeading();

    containerEl.createEl('p', {
      text: 'Configure the CLI tool that powers the AI chat feature on iOS. ' +
        'The tool is spawned on the remote server via extension.invoke.',
      cls: 'setting-item-description',
    });

    const llmPlugin = this.pluginRef as Plugin & {
      settings: { llmToolName?: string; llmToolArgs?: Record<string, string> };
      saveSettings: () => Promise<void>;
    };

    new Setting(containerEl)
      .setName('LLM tool name')
      .setDesc('Command to invoke on the remote server. Must be in PATH. Default: gemini')
      .addText(t => t
        .setPlaceholder('gemini')
        .setValue(llmPlugin.settings.llmToolName ?? 'gemini')
        .onChange(async v => {
          llmPlugin.settings.llmToolName = v.trim() || 'gemini';
          await llmPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('LLM tool args')
      .setDesc('JSON object of additional arguments. Example: {"run":"run"}')
      .addText(t => t
        .setPlaceholder('{"run":"run"}')
        .setValue(JSON.stringify(llmPlugin.settings.llmToolArgs ?? {}))
        .onChange(async v => {
          try {
            const parsed = JSON.parse(v.trim() || '{}');
            if (typeof parsed !== 'object' || parsed === null) throw new Error();
            llmPlugin.settings.llmToolArgs = parsed;
            await llmPlugin.saveSettings();
          } catch (_) { /* invalid JSON during typing */ }
        }));

    new Setting(containerEl)
      .setName('Relay probe')
      .setDesc('Checks whether the configured relay endpoint is reachable from mobile.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayProbe();
          if (result.status === 'PASS') {
            new Notice('Remote SSH: relay probe passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice('Remote SSH: relay probe warning');
            return;
          }
          new Notice('Remote SSH: relay probe failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayProbe();
          const report = this.pluginRef.formatMobileRelayProbeReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: relay probe report copied');
        }));

    new Setting(containerEl)
      .setName('Relay connect test')
      .setDesc('POST active profile to relay /v1/connect and inspect relay response code.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayConnectTest();
          if (result.status === 'PASS') {
            new Notice('Remote SSH: relay connect test passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice(`Remote SSH: relay connect test warning${result.code ? ` (${result.code})` : ''}`);
            return;
          }
          new Notice('Remote SSH: relay connect test failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayConnectTest();
          const report = this.pluginRef.formatMobileRelayConnectReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: relay connect test report copied');
        }));

    new Setting(containerEl)
      .setName('Relay stream test')
      .setDesc('Runs relay connect then opens streamUrl websocket and waits for session.ready.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayStreamTest();
          if (result.status === 'PASS') {
            new Notice('Remote SSH: relay stream test passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice('Remote SSH: relay stream test warning');
            return;
          }
          new Notice('Remote SSH: relay stream test failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayStreamTest();
          const report = this.pluginRef.formatMobileRelayStreamReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: relay stream test report copied');
        }));

    new Setting(containerEl)
      .setName('Relay JSON-RPC test')
      .setDesc('stream test + JSON-RPC auth/server.info handshake over WebSocket.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayRpcTest();
          if (result.status === 'PASS') {
            new Notice('Remote SSH: relay RPC test passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice('Remote SSH: relay RPC test warning');
            return;
          }
          new Notice('Remote SSH: relay RPC test failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileRelayRpcTest();
          const report = this.pluginRef.formatMobileRelayRpcReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: relay RPC test report copied');
        }));

    new Setting(containerEl)
      .setName('Mainline connect test')
      .setDesc('If relay endpoint is configured, tests relay JSON-RPC path. Otherwise attempts direct SSH connect.')
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(async () => {
          const result = await this.pluginRef.runMobileSshConnectTest();
          if (result.attempted === 0) {
            new Notice('Remote SSH: mainline connect test skipped (no profiles configured)');
            return;
          }
          if (result.status === 'PASS') {
            new Notice('Remote SSH: mainline connect test passed');
            return;
          }
          if (result.status === 'WARN') {
            new Notice('Remote SSH: mainline connect test warning');
            return;
          }
          new Notice('Remote SSH: mainline connect test failed');
        }))
      .addButton(btn => btn
        .setButtonText('Copy report')
        .onClick(async () => {
          const result = await this.pluginRef.runMobileSshConnectTest();
          const report = this.pluginRef.formatMobileSshConnectReport(result);
          void navigator.clipboard.writeText(report);
          new Notice('Remote SSH: mainline connect test report copied');
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

      new Setting(containerEl)
        .setName('Transport')
        .setDesc('Desktop parity: relay-rpc uses relay server; direct-ws connects over Tailscale directly to Go daemon.')
        .addDropdown(d => d
          .addOption('sftp', 'SFTP')
          .addOption('rpc', 'SSH + RPC daemon')
          .addOption('relay-rpc', 'Relay-RPC')
          .addOption('direct-ws', 'Direct WebSocket')
          .setValue(p.transport ?? 'sftp')
          .onChange(async v => {
            await this.pluginRef.updateMobileProfile(p.id, { transport: v as 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws' });
            this.display();
          }));

      if ((p.transport ?? 'sftp') !== 'relay-rpc' && p.transport !== 'direct-ws') {
        new Setting(containerEl)
          .setName('Mobile transport note')
          .setDesc('SFTP/RPC may fail on mobile depending on runtime Node API availability. For desktop-equivalent behavior, use relay-rpc or direct-ws.');
      }

      if (p.transport === 'direct-ws') {
        new Setting(containerEl)
          .setName('WebSocket host')
          .setDesc('Tailscale IP or hostname of the Go daemon.')
          .addText(t => t
            .setPlaceholder('100.x.y.z')
            .setValue(p.wsHost ?? '')
            .onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { wsHost: v.trim() });
            }));

        new Setting(containerEl)
          .setName('WebSocket port')
          .setDesc('Port of the Go daemon --ws-addr (default 9023).')
          .addText(t => t
            .setPlaceholder('9023')
            .setValue(p.wsPort ? String(p.wsPort) : '')
            .onChange(async v => {
              const n = Number.parseInt(v, 10);
              if (Number.isFinite(n) && n > 0 && n <= 65535) {
                await this.pluginRef.updateMobileProfile(p.id, { wsPort: n });
              }
            }));

        new Setting(containerEl)
          .setName('WebSocket token (optional)')
          .setDesc('When left empty, the token is fetched automatically from http://host:port/token.')
          .addText(t => {
            t.inputEl.type = 'password';
            t.setValue(p.wsToken ?? '');
            t.onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { wsToken: v.trim() });
            });
          });
      }

      if ((p.transport ?? 'sftp') === 'relay-rpc') {
        new Setting(containerEl)
          .setName('Relay base URL (profile)')
          .setDesc('Example: https://relay.example.com (fallback to global relay endpoint when empty).')
          .addText(t => t
            .setPlaceholder('https://relay.example.com')
            .setValue(p.relayBaseUrl ?? '')
            .onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { relayBaseUrl: v.trim() });
            }));

        new Setting(containerEl)
          .setName('Relay bearer token (profile, optional)')
          .setDesc('Optional Authorization bearer token for /v1/connect.')
          .addText(t => {
            t.inputEl.type = 'password';
            t.setValue(p.relayAuthToken ?? '');
            t.onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { relayAuthToken: v.trim() });
            });
          });

        new Setting(containerEl)
          .setName('Relay RPC username (profile)')
          .setDesc('Default fallback: admin')
          .addText(t => t
            .setPlaceholder('admin')
            .setValue(p.relayRpcUsername ?? '')
            .onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { relayRpcUsername: v.trim() });
            }));

        new Setting(containerEl)
          .setName('Relay RPC password (profile)')
          .setDesc('Default fallback: password')
          .addText(t => {
            t.inputEl.type = 'password';
            t.setValue(p.relayRpcPassword ?? '');
            t.onChange(async v => {
              await this.pluginRef.updateMobileProfile(p.id, { relayRpcPassword: v.trim() });
            });
          });
      }
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

