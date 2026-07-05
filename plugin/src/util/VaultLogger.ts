import { Platform, TFile } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

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

    this.logFile = this.app.vault.getAbstractFileByPath(DEBUG_LOG_FILE) as TFile | null;
    if (!this.logFile) {
      try {
        this.logFile = await this.app.vault.create(DEBUG_LOG_FILE, '');
      } catch {
        this.enabled = false;
        return false;
      }
    }

    await this.rotateIfNeeded();
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    this.log('INFO', '=== Remote SSH Plugin starting ===', {
      platform: Platform.isMobileApp ? 'mobile' : 'desktop',
      version: this.manifest.version,
    });

    return true;
  }

  log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>) {
    if (!this.enabled) return;
    const line = `[${new Date().toISOString()}] [${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
    this.buffer.push(line);
    if (this.buffer.length >= BUFFER_FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  private async flush() {
    if (!this.enabled || !this.logFile || this.buffer.length === 0) return;
    const text = `${this.buffer.splice(0, this.buffer.length).join('\n')}\n`;
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
      const lines = content.split('\n').filter((l) => l.trim());
      if (lines.length > MAX_LOG_LINES) {
        const keep = lines.slice(-Math.floor(MAX_LOG_LINES * 0.5));
        await this.app.vault.modify(this.logFile, `${keep.join('\n')}\n`);
      }
    } catch {
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    void this.flush();
    this.enabled = false;
  }
}
