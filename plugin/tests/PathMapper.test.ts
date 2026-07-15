import { describe, it, expect } from 'vitest';
import {
  PathMapper,
  sanitizeClientId,
  defaultClientId,
  defaultUserName,
  DEFAULT_PRIVATE_PATTERNS,
} from '../src/path/PathMapper';

const ID = 'host-a';

describe('sanitizeClientId', () => {
  it('passes through ASCII alphanumerics + dot/hyphen/underscore', () => {
    expect(sanitizeClientId('GERMI')).toBe('GERMI');
    expect(sanitizeClientId('node-1.local_2')).toBe('node-1.local_2');
  });

  it('replaces unsafe characters with hyphen and trims them at the edges', () => {
    expect(sanitizeClientId('host with spaces')).toBe('host-with-spaces');
    expect(sanitizeClientId('!!evil!!')).toBe('evil');
  });

  it('falls back to "unknown" when the input is empty after sanitisation', () => {
    expect(sanitizeClientId('')).toBe('unknown');
    expect(sanitizeClientId('!!!')).toBe('unknown');
  });
});

describe('defaultClientId / defaultUserName', () => {
  it('defaultClientId returns a non-empty sanitized string', () => {
    const id = defaultClientId();
    expect(id).not.toBe('');
    // The same string should pass through sanitize unchanged.
    expect(sanitizeClientId(id)).toBe(id);
  });

  it('defaultUserName returns a non-empty string', () => {
    const u = defaultUserName();
    expect(u).not.toBe('');
  });
});

describe('PathMapper.isPrivate', () => {
  const m = new PathMapper(ID);

  it('matches the canonical private files', () => {
    expect(m.isPrivate('.obsidian/workspace.json')).toBe(true);
    expect(m.isPrivate('.obsidian/cache.zlib')).toBe(true);
    expect(m.isPrivate('.obsidian/types.json')).toBe(true);
  });

  it('treats per-device settings (app/appearance/core-plugins/hotkeys) as private', () => {
    // Moved from shared → per-client so two devices (or one device
    // across reconnects) never collide on a single shared copy — the
    // perpetual write-conflict this fixes.
    expect(m.isPrivate('.obsidian/app.json')).toBe(true);
    expect(m.isPrivate('.obsidian/appearance.json')).toBe(true);
    expect(m.isPrivate('.obsidian/core-plugins.json')).toBe(true);
    expect(m.isPrivate('.obsidian/hotkeys.json')).toBe(true);
  });

  it('matches inside a private directory pattern', () => {
    expect(m.isPrivate('.obsidian/cache/index')).toBe(true);
    expect(m.isPrivate('.obsidian/cache/sub/x.bin')).toBe(true);
  });

  it('rejects sibling paths that share a prefix', () => {
    expect(m.isPrivate('.obsidian/cache.zlib2')).toBe(false);
    expect(m.isPrivate('.obsidian/workspace.json.bak')).toBe(false);
  });

  it('rejects regular vault content', () => {
    expect(m.isPrivate('Notes/foo.md')).toBe(false);
    // community-plugins.json stays shared (round-tripped with a forced
    // remote-ssh union), so it is NOT redirected per-client.
    expect(m.isPrivate('.obsidian/community-plugins.json')).toBe(false);
  });

  it('tolerates a leading slash on the input', () => {
    expect(m.isPrivate('/.obsidian/workspace.json')).toBe(true);
  });
});

// #342 / #429 — a plugin's SETTINGS go per-device: `Plugin.saveData()` fires on
// every settings change, so a shared `plugins/<id>/data.json` is the same
// perpetual write-conflict the four core config files were redirected to
// escape. Its CODE must stay SHARED, or a plugin installed on one machine
// stops loading on the others (that round-trip is PLUGIN_BINARY_FILES).
describe('PathMapper — plugin settings vs plugin code (#342 / #429)', () => {
  const m = new PathMapper(ID);

  it('privatises a plugin data.json', () => {
    expect(m.isPrivate('.obsidian/plugins/claudian/data.json')).toBe(true);
    expect(m.isPrivate('.obsidian/plugins/tasknotes/data.json')).toBe(true);
  });

  it('leaves the plugin code SHARED', () => {
    expect(m.isPrivate('.obsidian/plugins/claudian/main.js')).toBe(false);
    expect(m.isPrivate('.obsidian/plugins/claudian/manifest.json')).toBe(false);
    expect(m.isPrivate('.obsidian/plugins/claudian/styles.css')).toBe(false);
  });

  it('does not over-match: `*` spans exactly one segment', () => {
    expect(m.isPrivate('.obsidian/plugins')).toBe(false);
    expect(m.isPrivate('.obsidian/plugins/claudian')).toBe(false);
    expect(m.isPrivate('.obsidian/plugins/a/b/data.json')).toBe(false);
    expect(m.isPrivate('.obsidian/data.json')).toBe(false);
    expect(m.isPrivate('Notes/data.json')).toBe(false);
  });

  it('redirects data.json per-client, keeping code at the identity path', () => {
    expect(m.toRemote('.obsidian/plugins/claudian/data.json'))
      .toBe('.obsidian/user/host-a/plugins/claudian/data.json');
    expect(m.toRemote('.obsidian/plugins/claudian/main.js'))
      .toBe('.obsidian/plugins/claudian/main.js');
  });

  it('round-trips through toVault', () => {
    const remote = m.toRemote('.obsidian/plugins/claudian/data.json');
    expect(m.toVault(remote)).toBe('.obsidian/plugins/claudian/data.json');
  });

  it('listing a plugin dir merges in this client private subtree', () => {
    const plan = m.resolveListing('.obsidian/plugins/claudian');
    expect(plan.primary).toBe('.obsidian/plugins/claudian');
    expect(plan.mergeFromUser).toBe(true);
    expect(plan.userSubtree).toBe('.obsidian/user/host-a/plugins/claudian');
    // The `user` sibling only exists at the configDir level, so nothing to
    // hide at this depth.
    expect(plan.hideUserDirName).toBeUndefined();
  });

  it('still hides the user subdir when listing the configDir itself', () => {
    const plan = m.resolveListing('.obsidian');
    expect(plan.mergeFromUser).toBe(true);
    expect(plan.userSubtree).toBe('.obsidian/user/host-a');
    expect(plan.hideUserDirName).toBe('user');
  });
});

describe('PathMapper.isCrossingPoint', () => {
  it('flags `.obsidian/` because every private pattern lives directly under it', () => {
    const m = new PathMapper(ID);
    expect(m.isCrossingPoint('.obsidian')).toBe(true);
  });

  it('does not flag the private dirs themselves (those are private, not crossing)', () => {
    const m = new PathMapper(ID);
    expect(m.isCrossingPoint('.obsidian/cache')).toBe(false);
    expect(m.isCrossingPoint('.obsidian/workspace.json')).toBe(false);
  });

  it('does not flag unrelated parents', () => {
    const m = new PathMapper(ID);
    expect(m.isCrossingPoint('Notes')).toBe(false);
    expect(m.isCrossingPoint('')).toBe(false);
  });
});

describe('PathMapper.toRemote / toVault', () => {
  const m = new PathMapper(ID);

  it('redirects private files into the per-client subtree', () => {
    expect(m.toRemote('.obsidian/workspace.json'))
      .toBe('.obsidian/user/host-a/workspace.json');
    expect(m.toRemote('.obsidian/cache/foo.bin'))
      .toBe('.obsidian/user/host-a/cache/foo.bin');
    expect(m.toRemote('.obsidian/app.json'))
      .toBe('.obsidian/user/host-a/app.json');
  });

  it('passes non-private paths through unchanged', () => {
    expect(m.toRemote('Notes/foo.md')).toBe('Notes/foo.md');
    expect(m.toRemote('.obsidian/community-plugins.json')).toBe('.obsidian/community-plugins.json');
    expect(m.toRemote('.obsidian')).toBe('.obsidian');
  });

  it('toVault inverts a redirected path back to its vault-relative form', () => {
    expect(m.toVault('.obsidian/user/host-a/workspace.json'))
      .toBe('.obsidian/workspace.json');
    expect(m.toVault('.obsidian/user/host-a/cache/foo.bin'))
      .toBe('.obsidian/cache/foo.bin');
  });

  it('leaves another client\'s subtree alone (so the caller can filter it out)', () => {
    expect(m.toVault('.obsidian/user/host-b/workspace.json'))
      .toBe('.obsidian/user/host-b/workspace.json');
  });

  it('uses the configured client id for the redirect prefix', () => {
    const other = new PathMapper('SomeBox');
    expect(other.toRemote('.obsidian/workspace.json'))
      .toBe('.obsidian/user/SomeBox/workspace.json');
  });

  it('isolates per-device settings by client id (no cross-machine clobber)', () => {
    // The whole point of making app.json per-device: two machines writing
    // "the same" config file land on DIFFERENT remote paths, so neither can
    // trip the other's write-precondition (the perpetual conflict fixed here).
    const a = new PathMapper('host-a');
    const b = new PathMapper('host-b');
    expect(a.toRemote('.obsidian/app.json')).toBe('.obsidian/user/host-a/app.json');
    expect(b.toRemote('.obsidian/app.json')).toBe('.obsidian/user/host-b/app.json');
    expect(a.toRemote('.obsidian/app.json')).not.toBe(b.toRemote('.obsidian/app.json'));
  });
});

describe('PathMapper.resolveListing', () => {
  const m = new PathMapper(ID);

  it('asks the caller to merge `.obsidian` with the user subtree, hiding the user/ dir', () => {
    const r = m.resolveListing('.obsidian');
    expect(r.primary).toBe('.obsidian');
    expect(r.mergeFromUser).toBe(true);
    expect(r.userSubtree).toBe('.obsidian/user/host-a');
    expect(r.hideUserDirName).toBe('user');
  });

  it('redirects a list of a private directory entirely', () => {
    const r = m.resolveListing('.obsidian/cache');
    expect(r.primary).toBe('.obsidian/user/host-a/cache');
    expect(r.mergeFromUser).toBe(false);
  });

  it('passes ordinary listings through', () => {
    const r = m.resolveListing('Notes');
    expect(r.primary).toBe('Notes');
    expect(r.mergeFromUser).toBe(false);
  });

  it('passes `.obsidian/plugins` through unmerged (not a crossing point under default patterns)', () => {
    const r = m.resolveListing('.obsidian/plugins');
    expect(r.primary).toBe('.obsidian/plugins');
    expect(r.mergeFromUser).toBe(false);
  });
});

describe('PathMapper with custom patterns', () => {
  it('respects caller-supplied private patterns instead of the defaults', () => {
    // Patterns must live under .obsidian/ so they redirect cleanly into the
    // per-client subtree; this test extends the list with a hypothetical
    // graph-experimental.json that ships with a future Obsidian version.
    const m = new PathMapper(ID, ['.obsidian/graph-experimental.json']);
    expect(m.isPrivate('.obsidian/graph-experimental.json')).toBe(true);
    expect(m.isPrivate('.obsidian/workspace.json')).toBe(false); // not in custom list
    expect(m.toRemote('.obsidian/graph-experimental.json'))
      .toBe('.obsidian/user/host-a/graph-experimental.json');
  });

  it('exports a stable default pattern list', () => {
    expect(DEFAULT_PRIVATE_PATTERNS).toContain('.obsidian/workspace.json');
    expect(DEFAULT_PRIVATE_PATTERNS).toContain('.obsidian/cache');
  });
});
