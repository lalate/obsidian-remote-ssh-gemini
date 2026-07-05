import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

// main.ts pulls in RemoteTerminalView (extends the obsidian ItemView the unit
// mock doesn't model) — stub it so the import graph resolves. Same shim the
// sibling connectProfile.daemon-downgrade.test.ts uses.
vi.mock('../src/ui/RemoteTerminalView', () => ({
  RemoteTerminalView: class {},
  VIEW_TYPE_REMOTE_TERMINAL: 'remote-terminal',
}));

import { App } from 'obsidian';
import RemoteSshPlugin from '../src/main.desktop';

/** A fake SftpClient whose `exec` answers the daemon's `uname` probe. */
const linuxAmd64Client = {
  exec: async (cmd: string) => ({
    stdout: cmd === 'uname -s' ? 'Linux' : 'x86_64',
    stderr: '',
    exitCode: 0,
  }),
};

const tmpDirs: string[] = [];
function scratchPluginDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rs-daemon-${process.pid}-`));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'server-bin'), { recursive: true });
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) {
    try { fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const BIN_NAME = 'obsidian-remote-server-linux-amd64';

describe('RemoteSshPlugin.locateDaemonBinary — .dev-daemon marker gate', () => {
  it('returns null for an UNMARKED staged binary (a download must not masquerade as a dev build)', () => {
    const plugin = new RemoteSshPlugin(new App() as never);
    const dir = scratchPluginDir();
    fs.writeFileSync(path.join(dir, 'server-bin', BIN_NAME), 'ELF');
    const p = plugin as unknown as { pluginDir: () => string; locateDaemonBinary: () => string | null };
    p.pluginDir = () => dir;

    expect(p.locateDaemonBinary()).toBeNull();
  });

  it('returns the binary path once dev-install has written the .dev-daemon marker', () => {
    const plugin = new RemoteSshPlugin(new App() as never);
    const dir = scratchPluginDir();
    const bin = path.join(dir, 'server-bin', BIN_NAME);
    fs.writeFileSync(bin, 'ELF');
    fs.writeFileSync(path.join(dir, 'server-bin', '.dev-daemon'), '');
    const p = plugin as unknown as { pluginDir: () => string; locateDaemonBinary: () => string | null };
    p.pluginDir = () => dir;

    expect(p.locateDaemonBinary()).toBe(bin);
  });
});

describe('RemoteSshPlugin.ensureDaemonBinary — version + sha fast path', () => {
  interface Internals {
    pluginDir: () => string;
    manifest: { version: string };
    settings: Record<string, unknown>;
    saveData: (d: unknown) => Promise<void>;
    confirmDaemonDownload: (v: string) => Promise<boolean>;
    ensureDaemonBinary: (client: unknown) => Promise<string | null>;
  }

  function makePlugin(dir: string, settings: Record<string, unknown>): Internals {
    const plugin = new RemoteSshPlugin(new App() as never);
    const p = plugin as unknown as Internals;
    p.pluginDir = () => dir;
    p.manifest = { version: '1.2.0' };
    p.settings = settings;
    p.saveData = async () => { /* no-op persist */ };
    return p;
  }

  it('reuses the cached binary WITHOUT any download when version + sha both match', async () => {
    const dir = scratchPluginDir();
    const bin = path.join(dir, 'server-bin', BIN_NAME);
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
    fs.writeFileSync(bin, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const p = makePlugin(dir, { daemonBinaryVersion: '1.2.0', daemonBinarySha: sha });

    // No requestUrl is mocked here: a fall-through to the download path would
    // throw, so returning the cached path proves the fast path fired.
    const result = await p.ensureDaemonBinary(linuxAmd64Client);
    expect(result).toBe(bin);
  });

  it('does NOT take the fast path when the cached bytes no longer match the sha (post-write corruption)', async () => {
    const dir = scratchPluginDir();
    // File whose real sha does NOT match the recorded marker → integrity fail.
    fs.writeFileSync(path.join(dir, 'server-bin', BIN_NAME), Buffer.from([0x00, 0x11, 0x22]));
    const p = makePlugin(dir, {
      daemonBinaryVersion: '1.2.0',
      daemonBinarySha: 'f'.repeat(64), // deliberately wrong
      daemonDownloadConsented: false,
    });
    // Fall-through reaches the consent gate; decline it to end deterministically
    // on the "staying on SFTP" path (no network) rather than the fast path.
    p.confirmDaemonDownload = async () => false;

    const result = await p.ensureDaemonBinary(linuxAmd64Client);
    expect(result).toBeNull(); // fell through (not reused) → declined → SFTP
  });

  it('does NOT take the fast path when the recorded version differs from the plugin version', async () => {
    const dir = scratchPluginDir();
    const bin = path.join(dir, 'server-bin', BIN_NAME);
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
    fs.writeFileSync(bin, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    // sha matches the file, but the marker is for an OLDER plugin version.
    const p = makePlugin(dir, {
      daemonBinaryVersion: '1.1.0',
      daemonBinarySha: sha,
      daemonDownloadConsented: false,
    });
    p.confirmDaemonDownload = async () => false;

    const result = await p.ensureDaemonBinary(linuxAmd64Client);
    expect(result).toBeNull(); // version mismatch → re-check path → declined → SFTP
  });
});
