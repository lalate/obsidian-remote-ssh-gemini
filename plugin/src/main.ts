import { Notice, Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

type DesktopPlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
};

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;

  async onload(): Promise<void> {
    if (Platform.isMobileApp) {
      this.addCommand({
        id: 'mobile-status',
        name: 'Mobile status (preview)',
        callback: () => {
          new Notice(
            'Remote SSH: mobile preview mode. Activation succeeded; desktop runtime is gated in this phase.',
          );
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
    this.desktopDelegate?.onunload();
  }
}

