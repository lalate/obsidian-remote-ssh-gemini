import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  ensureTrailingSlash,
  expandHome,
  normalizeRemotePath,
  posixJoin,
  relativeTo,
  sameRemotePath,
  toLocalPath,
  toRemotePath,
} from '../src/util/pathUtils';

describe('normalizeRemotePath', () => {
  it('strips a leading "~/" so the path becomes home-relative for SFTP', () => {
    expect(normalizeRemotePath('~/work/VaultDev/')).toBe('work/VaultDev');
    expect(normalizeRemotePath('~/.config')).toBe('.config');
  });

  it('rewrites a bare "~" as "."', () => {
    expect(normalizeRemotePath('~')).toBe('.');
  });

  it('leaves absolute paths untouched aside from trailing slashes', () => {
    expect(normalizeRemotePath('/home/alice/vault/')).toBe('/home/alice/vault');
    expect(normalizeRemotePath('/srv/vault')).toBe('/srv/vault');
  });

  it('trims trailing slashes but preserves the root "/"', () => {
    expect(normalizeRemotePath('foo/bar///')).toBe('foo/bar');
    expect(normalizeRemotePath('/')).toBe('/');
  });

  it('does not touch paths that contain "~" mid-string', () => {
    expect(normalizeRemotePath('/home/~weird/stuff')).toBe('/home/~weird/stuff');
  });

  it('trims surrounding whitespace from user input', () => {
    expect(normalizeRemotePath('  ~/work/VaultDev  ')).toBe('work/VaultDev');
  });
});

describe('path utility helpers', () => {
  it('posixJoin joins with a single slash', () => {
    expect(posixJoin('a', 'b', 'c')).toBe('a/b/c');
    expect(posixJoin('/a/', '/b//', 'c')).toBe('/a/b/c');
  });

  it('relativeTo returns full path when base does not match', () => {
    expect(relativeTo('/base', '/other/file.md')).toBe('/other/file.md');
  });

  it('relativeTo strips base with or without trailing slash', () => {
    expect(relativeTo('/base', '/base/file.md')).toBe('file.md');
    expect(relativeTo('/base/', '/base/file.md')).toBe('file.md');
  });

  it('ensureTrailingSlash appends only once', () => {
    expect(ensureTrailingSlash('/tmp/work')).toBe('/tmp/work/');
    expect(ensureTrailingSlash('/tmp/work/')).toBe('/tmp/work/');
  });

  it('toLocalPath uses platform-aware path join', () => {
    const result = toLocalPath('/tmp/work', 'docs/a.md');
    expect(result).toContain('docs');
    expect(result.endsWith('docs/a.md') || result.endsWith('docs\\a.md')).toBe(true);
  });

  it('toRemotePath uses posix separator', () => {
    expect(toRemotePath('/srv/vault', 'docs/a.md')).toBe('/srv/vault/docs/a.md');
  });

  it('expandHome expands "~/" using HOME', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = '/home/alice';
      delete process.env.USERPROFILE;
      // Use path.join for platform-agnostic comparison (Windows uses backslashes)
      expect(expandHome('~/vault')).toBe(path.join('/home/alice', 'vault'));
    } finally {
      if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('expandHome falls back to cwd-relative when neither HOME nor USERPROFILE is set', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      // home = '' → path.join('', 'vault') = 'vault'
      expect(expandHome('~/vault')).toBe(path.join('', 'vault'));
    } finally {
      if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('expandHome leaves non-tilde paths unchanged', () => {
    expect(expandHome('/srv/vault')).toBe('/srv/vault');
  });
});

describe('sameRemotePath (RPC daemon vault-root validation)', () => {
  it('equal paths match', () => {
    expect(sameRemotePath('/home/souta/work', '/home/souta/work')).toBe(true);
  });

  it('trailing slash is ignored on either side', () => {
    expect(sameRemotePath('/home/souta/work/', '/home/souta/work')).toBe(true);
    expect(sameRemotePath('/home/souta/work', '/home/souta/work/')).toBe(true);
    expect(sameRemotePath('/home/souta/work//', '/home/souta/work')).toBe(true);
  });

  it('surrounding whitespace is ignored', () => {
    expect(sameRemotePath('  /home/souta/work  ', '/home/souta/work')).toBe(true);
  });

  it('a deeper/old root does NOT match the wanted root (the field bug)', () => {
    // Stale daemon rooted at the deleted VaultDev vs profile now
    // pointing at ~/work → must NOT reuse, must redeploy.
    expect(sameRemotePath('/home/souta/work/VaultDev', '/home/souta/work')).toBe(false);
  });

  it('different paths do not match', () => {
    expect(sameRemotePath('/home/souta/a', '/home/souta/b')).toBe(false);
    expect(sameRemotePath('', '/home/souta/work')).toBe(false);
  });

  it('root path "/" is preserved (not stripped to empty)', () => {
    expect(sameRemotePath('/', '/')).toBe(true);
    expect(sameRemotePath('/', '')).toBe(false);
  });
});
