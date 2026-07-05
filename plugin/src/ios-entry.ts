/**
 * iOS entry point — same dispatcher pattern as main.ts, but uses static
 * imports instead of dynamic import() which isn't supported on iOS (JSC).
 *
 * Built as main.js for iOS releases.
 */
import { Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { VaultLogger } from './util/VaultLogger';
import MobileDelegate from './main.mobile';

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

    this.delegate = new MobileDelegate(this.app, this.manifest) as unknown as DelegatePlugin;

    if (this.delegate.setVaultLogger) {
      this.delegate.setVaultLogger(this.vaultLogger);
    }

    await this.delegate.onload();
  }

  onunload() {
    this.vaultLogger.log('INFO', 'Plugin unloading');
    this.delegate?.onunload();
    this.vaultLogger.destroy();
    this.delegate = null;
  }
}
