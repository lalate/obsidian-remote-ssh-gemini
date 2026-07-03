import { Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

/**
 * Minimal common interface both mobile and desktop plugin modules export.
 */
type DelegatePlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
};

/**
 * Entry-point plugin that delegates to the platform-specific implementation
 * loaded dynamically at runtime:
 *   - Desktop  → main.desktop.ts  (shadow vault, SSH daemon, full feature set)
 *   - Mobile   → main.mobile.ts   (WSS-Relay, in-process adapter, ChatUI)
 *
 * The delegate module is loaded once at startup and its lifecycle mirrors
 * this wrapper's own onload/onunload.
 */
export default class RemoteSshPlugin extends Plugin {
  private delegate: DelegatePlugin | null = null;

  async onload() {
    const src = Platform.isMobileApp ? './main.mobile' : './main.desktop';

    let mod: { default: new (app: App, manifest: PluginManifest) => DelegatePlugin };
    try {
      mod = await import(/* @vite-ignore */ src);
    } catch (e) {
      console.error(`Remote SSH: failed to load ${src}`, e);
      return;
    }

    this.delegate = new mod.default(this.app, this.manifest);
    await this.delegate.onload();
  }

  onunload() {
    this.delegate?.onunload();
    this.delegate = null;
  }
}
