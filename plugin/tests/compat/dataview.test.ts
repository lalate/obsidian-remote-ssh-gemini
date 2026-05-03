import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import type { TFile } from 'obsidian';
import { CompatVault } from './CompatVault';
import { fixturesDir, loadFixtures } from './fixtures';

/**
 * Phase E F11 — Dataview compat smoke.
 *
 * Drives the public `metadataCache.getFileCache()` API for every
 * file in `vault.getMarkdownFiles()` — the same shape Dataview's
 * `dv.pages('"folder"')` query takes. Asserts that the 5 fixture
 * files (4 with frontmatter + 1 without) all show up and that
 * downstream aggregations (count by status / by tag, sum priority,
 * group by assignee) produce the right answers.
 *
 * If this suite breaks against a future Obsidian-API drift, the
 * harness in CompatVault.ts needs updating before Dataview itself
 * can be diagnosed.
 */

interface DataviewPage {
  path: string;
  frontmatter: Record<string, unknown> | undefined;
}

/** The shape Dataview's `dv.pages(...)` returns, narrowed to what F11 cares about. */
function dvPages(vault: CompatVault, folder: string): DataviewPage[] {
  return vault.getMarkdownFiles()
    .filter((f: TFile) => f.path.startsWith(folder + '/'))
    .map((f: TFile) => ({
      path: f.path,
      frontmatter: vault.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined,
    }));
}

describe('Phase E F11 — Dataview compat smoke', () => {
  let vault: CompatVault;
  let pages: DataviewPage[];

  beforeEach(async () => {
    vault = new CompatVault();
    const loaded = await loadFixtures(vault, path.join(fixturesDir(), 'dataview-pages'));
    expect(loaded).toBe(5);
    pages = vault.getMarkdownFiles().map(f => ({
      path: f.path,
      frontmatter: vault.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined,
    }));
  });

  it('lists every loaded page (5 of 5, including the no-frontmatter one)', () => {
    const paths = pages.map(p => p.path).sort();
    expect(paths).toEqual([
      'task-five.md',
      'task-four.md',
      'task-one.md',
      'task-three.md',
      'task-two.md',
    ]);
  });

  it('returns frontmatter scalars for each task with a YAML block', () => {
    const byPath = Object.fromEntries(pages.map(p => [p.path, p.frontmatter ?? null]));
    expect(byPath['task-one.md']).toMatchObject({
      status: 'open', priority: 1, assignee: 'alice', tag: 'work',
    });
    expect(byPath['task-two.md']).toMatchObject({
      status: 'open', priority: 2, assignee: 'bob', tag: 'home',
    });
    expect(byPath['task-three.md']).toMatchObject({
      status: 'done', priority: 3, assignee: 'alice', tag: 'work',
    });
    expect(byPath['task-four.md']).toMatchObject({
      status: 'pending', priority: 4, assignee: 'bob', tag: 'home',
    });
  });

  it('still appears for the page with no frontmatter (frontmatter is undefined)', () => {
    const five = pages.find(p => p.path === 'task-five.md');
    expect(five).toBeDefined();
    expect(five!.frontmatter).toBeUndefined();
  });

  // ─── Dataview-shape aggregations ────────────────────────────────

  it('aggregates count by status (the FROM ... GROUP BY status query)', () => {
    const byStatus: Record<string, number> = {};
    for (const p of pages) {
      const s = (p.frontmatter?.status as string | undefined) ?? '(none)';
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    expect(byStatus).toEqual({ open: 2, done: 1, pending: 1, '(none)': 1 });
  });

  it('aggregates count by tag (work vs home, ignores (none))', () => {
    const byTag: Record<string, number> = {};
    for (const p of pages) {
      const t = p.frontmatter?.tag as string | undefined;
      if (!t) continue;
      byTag[t] = (byTag[t] ?? 0) + 1;
    }
    expect(byTag).toEqual({ work: 2, home: 2 });
  });

  it('sums priority across the 4 tasks with frontmatter (1+2+3+4 = 10)', () => {
    const total = pages.reduce(
      (sum, p) => sum + ((p.frontmatter?.priority as number | undefined) ?? 0),
      0,
    );
    expect(total).toBe(10);
  });

  it('groups paths by assignee (alice has 2, bob has 2, unassigned has 1)', () => {
    const byAssignee: Record<string, string[]> = {};
    for (const p of pages) {
      const a = (p.frontmatter?.assignee as string | undefined) ?? '(unassigned)';
      (byAssignee[a] ??= []).push(p.path);
    }
    expect(byAssignee.alice.sort()).toEqual(['task-one.md', 'task-three.md']);
    expect(byAssignee.bob.sort()).toEqual(['task-four.md', 'task-two.md']);
    expect(byAssignee['(unassigned)']).toEqual(['task-five.md']);
  });

  it('dvPages folder-scope helper filters correctly', async () => {
    // Drop a page outside the loaded namespace and confirm the
    // helper's `startsWith(folder + '/')` filter excludes / includes
    // by folder prefix.
    await vault.create('elsewhere/note.md', '---\ntag: work\n---\n');
    const inDataview = dvPages(vault, 'dataview-pages');
    expect(inDataview.length).toBe(0); // Loaded paths don't have a `dataview-pages/` prefix
    const inElsewhere = dvPages(vault, 'elsewhere');
    expect(inElsewhere.length).toBe(1);
    expect(inElsewhere[0].path).toBe('elsewhere/note.md');
  });
});
