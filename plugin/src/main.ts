import { Platform, Plugin, TFile, Vault } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

/**
 * Minimal common interface both mobile and desktop plugin modules export.
 */
type DelegatePlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
  setVaultLogger?: (logger: VaultLogger) => void;
};

// ===== Simple VaultLogger (inline, no extra files) =====
const DEBUG_LOG_FILE = 'remote-ssh-debug.log';
const MAX_LOG_LINES = 500;
const FLUSH_INTERVAL_MS = 1000;
const BUFFER_FLUSH_THRESHOLD = 20;

export class VaultLogger {
  private enabled = false;
  private buffer: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private logFile: TFile | null = null;

  constructor(private app: App, private manifest: PluginManifest) {}

  async initialize(): Promise<boolean> {
    this.enabled = true;

    // Get or create log file
    this.logFile = this.app.vault.getAbstractFileByPath(DEBUG_LOG_FILE) as TFile | null;
    if (!this.logFile) {
      try {
        this.logFile = await this.app.vault.create(DEBUG_LOG_FILE, '');
      } catch {
        this.enabled = false;
        return false;
      }
    }

    // Rotate if needed
    await this.rotateIfNeeded();

    // Periodic flush
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Initial log
    this.log('INFO', '=== Remote SSH Plugin starting ===', {
      platform: Platform.isMobileApp ? 'mobile' : 'desktop',
      version: this.manifest.version,
    });

    return true;
  }

  log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>) {
    if (!this.enabled) return;
    const line = `[${new Date().toISOString()}] [${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    this.buffer.push(line);
    if (this.buffer.length >= BUFFER_FLUSH_THRESHOLD) this.flush();
  }

  private async flush() {
    if (!this.enabled || !this.logFile || this.buffer.length === 0) return;
    const text = this.buffer.splice(0, this.buffer.length).join('\n') + '\n';
    try {
      await this.app.vault.append(this.logFile, text);
      await this.rotateIfNeeded();
    } catch (e) {
      console.error('[VaultLogger] flush failed:', e);
    }
  }

  private async rotateIfNeeded() {
    if (!this.logFile) return;
    try {
      const content = await this.app.vault.read(this.logFile);
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length > MAX_LOG_LINES) {
        const keep = lines.slice(-Math.floor(MAX_LOG_LINES * 0.5));
        await this.app.vault.modify(this.logFile, keep.join('\n') + '\n');
      }
    } catch {}
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.flush(); // final flush
    this.enabled = false;
  }
}

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
  private vaultLogger: VaultLogger;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.vaultLogger = new VaultLogger(app, manifest);
  }

  async onload() {
    // ★★★ Initialize logger FIRST - before any dynamic import ★★★
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
    
    // Pass logger to delegate if it supports it
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
