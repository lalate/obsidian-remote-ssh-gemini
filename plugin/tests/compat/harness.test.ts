import { describe, it, expect, beforeEach } from 'vitest';
import type { TAbstractFile, TFile } from 'obsidian';
import { CompatVault } from './CompatVault';
import { fixturesDir, loadFixtures } from './fixtures';

/**
 * Bridge `getAbstractFileByPath`'s `TAbstractFile | null` to the
 * `TFile` shape the read/cache APIs accept. The harness only ever
 * stores files (no folders), so the cast is safe — extracted to
 * cut the `as never` noise that the PR-224 review (L2) flagged.
 */
function asFile(f: TAbstractFile | null): TFile {
  if (!f) throw new Error('asFile: expected a file, got null');
  return f as unknown as TFile;
}

/**
 * Phase E E-α — verifies the compat harness itself is correctly
 * shaped before any plugin scenario (F11-F14) is layered on top.
 *
 * If a future plugin scenario starts failing, run this suite first
 * to rule out a harness regression vs a real Obsidian-API drift.
 */
describe('Phase E compat harness', () => {
  let vault: CompatVault;

  beforeEach(async () => {
    vault = new CompatVault();
    const loaded = await loadFixtures(vault, fixturesDir());
    // Fixture count is part of the contract — bumping the fixture set
    // is intentional, but a silent regression to the loader (e.g.
    // wrong glob) would also drop the count.
    expect(loaded).toBe(4);
  });

  describe('vault surface', () => {
    it('getMarkdownFiles returns every loaded .md', () => {
      const paths = vault.getMarkdownFiles().map(f => f.path).sort();
      expect(paths).toEqual([
        'note-with-frontmatter.md',
        'note-with-headings.md',
        'note-with-tasks.md',
        'plain-note.md',
      ]);
    });

    it('getAbstractFileByPath resolves loaded paths and returns null otherwise', () => {
      expect(vault.getAbstractFileByPath('plain-note.md')).not.toBeNull();
      expect(vault.getAbstractFileByPath('does-not-exist.md')).toBeNull();
    });

    it('cachedRead and read return identical UTF-8 bodies', async () => {
      const file = asFile(vault.getAbstractFileByPath('plain-note.md'));
      const a = await vault.read(file);
      const b = await vault.cachedRead(file);
      expect(a).toBe(b);
      expect(a.startsWith('Just a plain note.')).toBe(true);
    });

    it('create + modify + delete round-trip a text file with events', async () => {
      const events: Array<{ kind: string; path: string }> = [];
      vault.on('create', (...args: unknown[]) => events.push({ kind: 'create', path: (args[0] as { path: string }).path }));
      vault.on('modify', (...args: unknown[]) => events.push({ kind: 'modify', path: (args[0] as { path: string }).path }));
      vault.on('delete', (...args: unknown[]) => events.push({ kind: 'delete', path: (args[0] as { path: string }).path }));

      const created = await vault.create('new-note.md', '# hi\nfirst body');
      await vault.modify(created, '# hi\nsecond body');
      await vault.delete(created);

      const finalRead = vault.getAbstractFileByPath('new-note.md');
      expect(finalRead).toBeNull();
      expect(events).toEqual([
        { kind: 'create', path: 'new-note.md' },
        { kind: 'modify', path: 'new-note.md' },
        { kind: 'delete', path: 'new-note.md' },
      ]);
    });

    it('createBinary + readBinary round-trips bytes (Excalidraw-shape)', async () => {
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
      const file = await vault.createBinary(
        'attach.png',
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      );
      const back = await vault.readBinary(file);
      expect(new Uint8Array(back)).toEqual(data);
    });
  });

  describe('metadata cache', () => {
    it('parses frontmatter scalars (string / number / boolean)', () => {
      const file = asFile(vault.getAbstractFileByPath('note-with-frontmatter.md'));
      const cache = vault.metadataCache.getFileCache(file);
      expect(cache).not.toBeNull();
      const fm = cache!.frontmatter as Record<string, unknown>;
      expect(fm.title).toBe('Frontmatter sample');
      expect(fm.tags).toBe('test');
      expect(fm.priority).toBe(1);
      expect(fm.done).toBe(false);
    });

    it('extracts headings with level + text', () => {
      const file = asFile(vault.getAbstractFileByPath('note-with-headings.md'));
      const cache = vault.metadataCache.getFileCache(file);
      expect(cache).not.toBeNull();
      const headings = (cache!.headings ?? []).map(h => ({ heading: h.heading, level: h.level }));
      expect(headings).toEqual([
        { heading: 'Top heading',     level: 1 },
        { heading: 'Subheading A',    level: 2 },
        { heading: 'Deep subheading', level: 3 },
        { heading: 'Subheading B',    level: 2 },
      ]);
    });

    it('extracts checkbox tasks (open vs done) and ignores non-task lines', () => {
      const file = asFile(vault.getAbstractFileByPath('note-with-tasks.md'));
      const cache = vault.metadataCache.getFileCache(file);
      expect(cache).not.toBeNull();
      const tasks = (cache!.listItems ?? []).map(t => t.task);
      // 4 expected: 2 open (' '), 2 done ('x' — uppercase X collapses to 'x').
      expect(tasks).toEqual([' ', 'x', ' ', 'x']);
    });

    it('produces empty headings / listItems and no frontmatter for the plain note', () => {
      const file = asFile(vault.getAbstractFileByPath('plain-note.md'));
      const cache = vault.metadataCache.getFileCache(file);
      expect(cache).not.toBeNull();
      expect(cache!.frontmatter).toBeUndefined();
      expect(cache!.headings).toEqual([]);
      expect(cache!.listItems).toEqual([]);
    });

    it('parses frontmatter from a CRLF-encoded body identically to LF (L3)', async () => {
      const body = '---\r\ntitle: CRLF\r\nflag: true\r\n---\r\n# Heading\r\n';
      await vault.create('crlf.md', body);
      const file = asFile(vault.getAbstractFileByPath('crlf.md'));
      const cache = vault.metadataCache.getFileCache(file);
      const fm = cache!.frontmatter as Record<string, unknown>;
      expect(fm.title).toBe('CRLF');
      expect(fm.flag).toBe(true);
      expect(cache!.headings?.[0]?.heading).toBe('Heading');
    });

    it('rebuilds the cache after modify so a body change is reflected', async () => {
      const file = asFile(vault.getAbstractFileByPath('plain-note.md'));
      await vault.modify(file, '# Now I have a heading');
      const cache = vault.metadataCache.getFileCache(file);
      expect(cache!.headings?.[0]?.heading).toBe('Now I have a heading');
    });

    it('invalidates the cache on delete', async () => {
      const file = asFile(vault.getAbstractFileByPath('plain-note.md'));
      await vault.delete(file);
      // The TFile reference is now dangling but still has a path; the
      // cache lookup must return null so plugins don't see stale data.
      expect(vault.metadataCache.getFileCache(file)).toBeNull();
    });
  });
});
