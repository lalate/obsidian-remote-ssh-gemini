import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import {
  parseUname,
  binaryFilename,
  detectRemoteTarget,
  ensureDaemonBinary,
  resolveDaemonConsent,
  DaemonVerificationError,
  type DaemonDownloaderDeps,
  type DaemonTarget,
} from '../src/transport/DaemonDownloader';

describe('parseUname', () => {
  it('maps linux x86_64 -> linux-amd64', () => {
    expect(parseUname('Linux', 'x86_64')).toEqual({ os: 'linux', arch: 'amd64' });
  });
  it('maps darwin arm64 -> darwin-arm64', () => {
    expect(parseUname('Darwin', 'arm64')).toEqual({ os: 'darwin', arch: 'arm64' });
  });
  it('maps linux aarch64 -> linux-arm64', () => {
    expect(parseUname('Linux', 'aarch64')).toEqual({ os: 'linux', arch: 'arm64' });
  });
  it('maps darwin x86_64 -> darwin-amd64', () => {
    expect(parseUname('Darwin', 'x86_64')).toEqual({ os: 'darwin', arch: 'amd64' });
  });
  it('is case-insensitive and trims whitespace', () => {
    expect(parseUname(' Linux\n', 'AMD64')).toEqual({ os: 'linux', arch: 'amd64' });
  });
  it('returns null for Windows (MINGW/MSYS uname)', () => {
    expect(parseUname('MINGW64_NT-10.0', 'x86_64')).toBeNull();
  });
  it('returns null for unsupported OS', () => {
    expect(parseUname('FreeBSD', 'amd64')).toBeNull();
  });
  it('returns null for 32-bit arch', () => {
    expect(parseUname('Linux', 'i686')).toBeNull();
  });
});

describe('binaryFilename', () => {
  it('formats os-arch', () => {
    expect(binaryFilename({ os: 'darwin', arch: 'arm64' })).toBe('obsidian-remote-server-darwin-arm64');
  });
});

describe('detectRemoteTarget', () => {
  it('queries `uname -s` then `uname -m`', async () => {
    const calls: string[] = [];
    const exec = async (cmd: string): Promise<string> => {
      calls.push(cmd);
      return cmd === 'uname -s' ? 'Linux' : 'x86_64';
    };
    expect(await detectRemoteTarget(exec)).toEqual({ os: 'linux', arch: 'amd64' });
    expect(calls).toEqual(['uname -s', 'uname -m']);
  });
  it('returns null on unsupported remote', async () => {
    const exec = async (cmd: string): Promise<string> =>
      cmd === 'uname -s' ? 'OpenBSD' : 'amd64';
    expect(await detectRemoteTarget(exec)).toBeNull();
  });
});

describe('ensureDaemonBinary', () => {
  const target: DaemonTarget = { os: 'linux', arch: 'amd64' };
  const filename = 'obsidian-remote-server-linux-amd64';
  const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02, 0x03]); // fake ELF-ish
  const sha = createHash('sha256').update(bytes).digest('hex');

  function makeDeps(
    over: Partial<DaemonDownloaderDeps> = {},
  ): DaemonDownloaderDeps & { written: Map<string, Uint8Array>; urls: string[] } {
    const written = new Map<string, Uint8Array>();
    const urls: string[] = [];
    return {
      written,
      urls,
      fetchText: async (u) => {
        urls.push(u);
        return JSON.stringify({ [filename]: sha });
      },
      fetchBinary: async (u) => {
        urls.push(u);
        return bytes;
      },
      cacheDir: '/vault/.obsidian/plugins/remote-ssh/server-bin',
      cacheHit: () => false,
      writeExecutable: async (p, b) => {
        written.set(p, b);
      },
      repo: 'sotashimozono/obsidian-remote-ssh',
      version: '1.1.3',
      ...over,
    };
  }

  it('downloads, verifies sha256, caches, and returns the path', async () => {
    const deps = makeDeps();
    const p = await ensureDaemonBinary(deps, target);
    expect(p).toContain(filename);
    expect(deps.written.get(p)).toEqual(bytes);
  });

  it('uses the cache and does NOT download on a cache hit', async () => {
    let fetched = false;
    const deps = makeDeps({
      cacheHit: () => true,
      fetchBinary: async () => {
        fetched = true;
        return bytes;
      },
    });
    const p = await ensureDaemonBinary(deps, target);
    expect(p).toContain(filename);
    expect(fetched).toBe(false);
  });

  it('throws DaemonVerificationError on sha256 mismatch (never caches)', async () => {
    const deps = makeDeps({
      fetchText: async () => JSON.stringify({ [filename]: 'deadbeef' }),
    });
    await expect(ensureDaemonBinary(deps, target)).rejects.toBeInstanceOf(DaemonVerificationError);
    expect(deps.written.size).toBe(0);
  });

  it('throws when the manifest has no entry for the target', async () => {
    const deps = makeDeps({
      fetchText: async () => JSON.stringify({ 'obsidian-remote-server-darwin-arm64': sha }),
    });
    await expect(ensureDaemonBinary(deps, target)).rejects.toBeInstanceOf(DaemonVerificationError);
  });

  it('throws on malformed manifest JSON', async () => {
    const deps = makeDeps({ fetchText: async () => 'not json{' });
    await expect(ensureDaemonBinary(deps, target)).rejects.toBeInstanceOf(DaemonVerificationError);
  });

  it('builds the GitHub release URLs from repo + version (manifest first, then binary)', async () => {
    const deps = makeDeps();
    await ensureDaemonBinary(deps, target);
    expect(deps.urls).toEqual([
      'https://github.com/sotashimozono/obsidian-remote-ssh/releases/download/1.1.3/daemon-manifest.json',
      'https://github.com/sotashimozono/obsidian-remote-ssh/releases/download/1.1.3/obsidian-remote-server-linux-amd64',
    ]);
  });

  it('accepts an UPPERCASE manifest sha (case-insensitive compare)', async () => {
    const deps = makeDeps({
      fetchText: async () => JSON.stringify({ [filename]: sha.toUpperCase() }),
    });
    const p = await ensureDaemonBinary(deps, target);
    expect(p).toContain(filename);
    expect(deps.written.get(p)).toEqual(bytes);
  });
});

describe('resolveDaemonConsent', () => {
  it('skips the prompt and returns true when already consented', async () => {
    const prompt = vi.fn();
    const persist = vi.fn();
    expect(await resolveDaemonConsent(true, prompt, persist)).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('prompts and persists an ACCEPT', async () => {
    const persisted: boolean[] = [];
    const r = await resolveDaemonConsent(false, async () => true, async (c) => { persisted.push(c); });
    expect(r).toBe(true);
    expect(persisted).toEqual([true]);
  });

  it('prompts and PERSISTS a decline so it does not re-prompt next time (#406 review)', async () => {
    const persisted: boolean[] = [];
    const r = await resolveDaemonConsent(false, async () => false, async (c) => { persisted.push(c); });
    expect(r).toBe(false);
    expect(persisted).toEqual([false]);
  });
});

// Deferred #406-review hardening, kept as executable specs (runnable TODOs)
// in place of tracking issues — unskip and implement when prioritized.
describe('deferred hardening (#406 review)', () => {
  it.todo('verifies the cosign .bundle (sigstore) against the GitHub OIDC identity before deploy — closes the MITM gap that sha256-from-the-same-channel leaves open');
  it.todo('shares the daemon binary cache across vaults/profiles (e.g. ~/.obsidian-remote/server-bin) so a second profile reuses the first download + single consent');
  it.todo('re-verifies a cache-hit binary against its sha256 before reuse — defends post-write on-disk corruption (the atomic tmp+rename write already closes the mid-download crash window)');
});
