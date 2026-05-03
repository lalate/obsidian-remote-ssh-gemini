import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import type { TAbstractFile, TFile } from 'obsidian';
import { CompatVault } from './CompatVault';
import { fixturesDir, loadFixtures } from './fixtures';

/**
 * Phase E F12 — Templater compat scripted scenario.
 *
 * Simulates Templater's `tp.file.create_new(template, filename)` +
 * subsequent `vault.modify()` flow against the harness. The point is
 * NOT to embed Templater itself — Templater doesn't need any work
 * from us, just the public Vault APIs. The point is to verify those
 * public APIs round-trip the way Templater expects.
 *
 * Hot APIs exercised:
 *   - `vault.read(template)`            — load template body
 *   - `vault.create(filename, content)` — drop the rendered file
 *   - `vault.modify(file, content)`     — user edits the result
 *   - `vault.on('create' | 'modify')`   — Templater listens for both
 *   - `metadataCache.getFileCache(...)` — frontmatter shows up post-create
 *
 * The `<% expr %>` evaluator is a deliberately-tiny substitute for
 * Templater's real one — just enough to cover `tp.date.now(fmt)` and
 * `tp.file.title`, the placeholders the bundled templates use.
 */

function asFile(f: TAbstractFile | null): TFile {
  if (!f) throw new Error('asFile: expected a file, got null');
  return f as unknown as TFile;
}

interface TemplaterContext {
  /** Filename (no .md extension) — `tp.file.title` resolves to this. */
  title: string;
  /** Frozen wall clock — `tp.date.now(fmt)` resolves against this. */
  now: Date;
}

/** Tiny `<% expr %>` evaluator. Throws on unknown expressions. */
function evalTemplate(body: string, ctx: TemplaterContext): string {
  return body.replace(/<%\s*([\s\S]*?)\s*%>/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === 'tp.file.title') return ctx.title;
    const m = /^tp\.date\.now\(\s*"([^"]+)"\s*\)$/.exec(trimmed);
    if (m) return formatDate(ctx.now, m[1]);
    throw new Error(`evalTemplate: unsupported expression: ${trimmed}`);
  });
}

/** Tiny moment-shape formatter — only the tokens we actually use. */
function formatDate(d: Date, fmt: string): string {
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return fmt.replace(/YYYY/g, yyyy).replace(/MM/g, mm).replace(/DD/g, dd);
}

/** The `tp.file.create_new(template, filename)` operation, harness-shape. */
async function tpCreateNew(
  vault: CompatVault,
  templatePath: string,
  filename: string,
  ctx: TemplaterContext,
): Promise<TFile> {
  const template = asFile(vault.getAbstractFileByPath(templatePath));
  const body = await vault.read(template);
  const rendered = evalTemplate(body, ctx);
  return await vault.create(filename, rendered);
}

describe('Phase E F12 — Templater compat scripted scenario', () => {
  let vault: CompatVault;
  // Frozen clock so date-placeholder assertions stay deterministic.
  const fixedNow = new Date(Date.UTC(2026, 4, 4)); // 2026-05-04

  beforeEach(async () => {
    vault = new CompatVault();
    const loaded = await loadFixtures(vault, path.join(fixturesDir(), 'templater', 'Templates'));
    expect(loaded).toBe(3);
  });

  describe('tp.file.create_new', () => {
    it('renders the daily template with tp.date.now and lands a new file', async () => {
      const events: string[] = [];
      vault.on('create', (...args: unknown[]) =>
        events.push(`create:${(args[0] as { path: string }).path}`));

      const file = await tpCreateNew(
        vault, 'daily-note.md', '2026-05-04.md',
        { title: '2026-05-04', now: fixedNow },
      );

      const body = await vault.read(file);
      expect(body).toContain('# Daily — 2026-05-04');
      expect(body).toContain('## Notes');
      expect(body).toContain('## Done');
      expect(body).not.toContain('<%'); // every placeholder consumed
      expect(events).toEqual(['create:2026-05-04.md']);
    });

    it('renders the project template — frontmatter scalars + tp.file.title heading', async () => {
      const file = await tpCreateNew(
        vault, 'project.md', 'Projects/Project Alpha.md',
        { title: 'Project Alpha', now: fixedNow },
      );

      const body = await vault.read(file);
      expect(body).toContain('# Project Alpha');
      expect(body).toContain('created: 2026-05-04');

      // metadataCache picks up the new file's frontmatter immediately
      // (CompatVault.create calls rebuildFor, mirroring Obsidian's
      // post-create indexing).
      const cache = vault.metadataCache.getFileCache(file);
      const fm = cache!.frontmatter as Record<string, unknown>;
      expect(fm.type).toBe('project');
      expect(fm.created).toBe('2026-05-04');
      expect(fm.status).toBe('active');
    });

    it('renders a template without date placeholders (negative-control)', async () => {
      const file = await tpCreateNew(
        vault, 'meeting.md', 'Meetings/2026-05-04 sync.md',
        { title: '2026-05-04 sync', now: fixedNow },
      );

      const body = await vault.read(file);
      expect(body).toContain('# 2026-05-04 sync');
      expect(body).not.toContain('<%');
      const fm = vault.metadataCache.getFileCache(file)!.frontmatter as Record<string, unknown>;
      expect(fm.type).toBe('meeting');
    });

    it('throws on duplicate target path (matches CompatVault.create contract)', async () => {
      await tpCreateNew(
        vault, 'daily-note.md', 'dup.md',
        { title: 'dup', now: fixedNow },
      );
      await expect(tpCreateNew(
        vault, 'daily-note.md', 'dup.md',
        { title: 'dup', now: fixedNow },
      )).rejects.toThrow(/already exists/);
    });

    it('throws on missing template (asFile rejects null)', async () => {
      await expect(tpCreateNew(
        vault, 'Templates/no-such-template.md', 'x.md',
        { title: 'x', now: fixedNow },
      )).rejects.toThrow(/expected a file, got null/);
    });
  });

  describe('user-script writes via vault.modify', () => {
    it('updates the body and refreshes the metadata cache', async () => {
      const file = await tpCreateNew(
        vault, 'project.md', 'Projects/Beta.md',
        { title: 'Beta', now: fixedNow },
      );

      const events: string[] = [];
      vault.on('modify', (...args: unknown[]) =>
        events.push(`modify:${(args[0] as { path: string }).path}`));

      const updated = '---\ntype: project\nstatus: archived\n---\n\n# Beta\n\n(archived)';
      await vault.modify(file, updated);

      const body = await vault.read(file);
      expect(body).toBe(updated);

      const fm = vault.metadataCache.getFileCache(file)!.frontmatter as Record<string, unknown>;
      expect(fm.status).toBe('archived');
      expect(events).toEqual(['modify:Projects/Beta.md']);
    });
  });
});
