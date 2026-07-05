import { Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { VaultLogger } from './util/VaultLogger';

type DelegatePlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
  setVaultLogger?: (logger: VaultLogger) => void;
};

export default class RemoteSshPlugin extends Plugin {
  private delegate: DelegatePlugin | null = null;
  private vaultLogger: VaultLogger;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.vaultLogger = new VaultLogger(app, manifest);
  }

  async onload() {
    await this.vaultLogger.initialize();

    const src = Platform.isMobileApp ? './main.mobile' : './main.desktop';

    let mod: { default: new (app: App, manifest: PluginManifest) => DelegatePlugin };
    try {
      mod = await import(/* @vite-ignore */ src);
    } catch (e) {
      this.vaultLogger.log('ERROR', `Failed to load delegate: ${src}`, { error: String(e) });
      console.error(`Remote SSH: failed to load ${src}`, e);
      return;
    }

    this.delegate = new mod.default(this.app, this.manifest);
    this.delegate.setVaultLogger?.(this.vaultLogger);
    await this.delegate.onload();
  }

  onunload() {
    this.vaultLogger.log('INFO', 'Plugin unloading');
    this.delegate?.onunload();
    this.vaultLogger.destroy();
    this.delegate = null;
  }
}
