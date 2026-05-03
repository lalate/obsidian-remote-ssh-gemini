import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import type { TFile } from 'obsidian';
import { CompatVault } from './CompatVault';
import { fixturesDir, loadFixtures } from './fixtures';

/**
 * Phase E F14 — Tasks / DataviewJS aggregation compat.
 *
 * The Tasks plugin scans `metadataCache.getFileCache(file).listItems`
 * across every markdown file in the vault to find `- [ ]` checkboxes;
 * DataviewJS runs arbitrary JS over the same cache. Both shapes
 * collapse to the same query: "iterate getMarkdownFiles, pull
 * listItems for each, aggregate".
 *
 * Issue #124 F14 calls for a 10-file fixture vault with mixed task
 * states. The bundled fixture set covers:
 *   - all-open / mixed / mostly-done / completed
 *   - empty file (negative-control: no listItems at all)
 *   - large list (10 tasks)
 *   - frontmatter-tagged file (so the "filter by tag" branch works)
 *
 * Asserts: total open / done / per-file aggregations / project-tag
 * filter / empty-set behaviour.
 */

interface TaskAggregate {
  path: string;
  open: number;
  done: number;
  total: number;
  /** Frontmatter, if any — for the "filter by tag" / Dataview-shape branch. */
  frontmatter: Record<string, unknown> | undefined;
}

function aggregateAllTasks(vault: CompatVault): TaskAggregate[] {
  return vault.getMarkdownFiles().map((f: TFile) => {
    const cache = vault.metadataCache.getFileCache(f);
    const tasks = cache?.listItems ?? [];
    const open = tasks.filter(t => t.task === ' ').length;
    const done = tasks.filter(t => t.task === 'x').length;
    return {
      path: f.path,
      open, done, total: open + done,
      frontmatter: cache?.frontmatter as Record<string, unknown> | undefined,
    };
  });
}

describe('Phase E F14 — Tasks / DataviewJS aggregation compat', () => {
  let vault: CompatVault;
  let aggregates: TaskAggregate[];

  beforeEach(async () => {
    vault = new CompatVault();
    const loaded = await loadFixtures(vault, path.join(fixturesDir(), 'tasks'));
    expect(loaded).toBe(10);
    aggregates = aggregateAllTasks(vault);
  });

  describe('vault enumeration', () => {
    it('lists all 10 fixture files via getMarkdownFiles', () => {
      const paths = vault.getMarkdownFiles().map(f => f.path).sort();
      expect(paths).toEqual([
        '01-mixed.md',     '02-empty.md',     '03-all-open.md',
        '04-mostly-done.md','05-completed.md', '06-large.md',
        '07-single.md',    '08-no-tasks.md',  '09-tagged.md',
        '10-archived.md',
      ]);
    });

    it('produces one aggregate row per file (including empty / no-task ones)', () => {
      expect(aggregates).toHaveLength(10);
    });
  });

  describe('Tasks-shape aggregations', () => {
    it('counts total open tasks across the vault (the FROM "" WHERE !done query)', () => {
      const totalOpen = aggregates.reduce((s, a) => s + a.open, 0);
      expect(totalOpen).toBe(18); // 2+0+3+1+0+5+1+0+2+4
    });

    it('counts total done tasks across the vault', () => {
      const totalDone = aggregates.reduce((s, a) => s + a.done, 0);
      expect(totalDone).toBe(16); // 1+0+0+2+3+5+0+0+1+4
    });

    it('counts total tasks (open + done) — both checkbox flavours included', () => {
      const totalTasks = aggregates.reduce((s, a) => s + a.total, 0);
      expect(totalTasks).toBe(34);
    });

    it('files with at least one task = 8 (excludes 02-empty, 08-no-tasks)', () => {
      const withTasks = aggregates.filter(a => a.total > 0).map(a => a.path).sort();
      expect(withTasks).toEqual([
        '01-mixed.md', '03-all-open.md', '04-mostly-done.md',
        '05-completed.md', '06-large.md', '07-single.md',
        '09-tagged.md', '10-archived.md',
      ]);
      expect(withTasks).toHaveLength(8);
    });

    it('per-file open/done counts match the fixture distribution', () => {
      const byPath = Object.fromEntries(aggregates.map(a => [a.path, { open: a.open, done: a.done }]));
      expect(byPath['01-mixed.md']).toEqual({ open: 2, done: 1 });
      expect(byPath['02-empty.md']).toEqual({ open: 0, done: 0 });
      expect(byPath['03-all-open.md']).toEqual({ open: 3, done: 0 });
      expect(byPath['04-mostly-done.md']).toEqual({ open: 1, done: 2 });
      expect(byPath['05-completed.md']).toEqual({ open: 0, done: 3 });
      expect(byPath['06-large.md']).toEqual({ open: 5, done: 5 });
      expect(byPath['07-single.md']).toEqual({ open: 1, done: 0 });
      expect(byPath['08-no-tasks.md']).toEqual({ open: 0, done: 0 });
      expect(byPath['09-tagged.md']).toEqual({ open: 2, done: 1 });
      expect(byPath['10-archived.md']).toEqual({ open: 4, done: 4 });
    });

    it('100%-complete files (open === 0 AND done > 0) — only 05-completed', () => {
      const allDone = aggregates.filter(a => a.open === 0 && a.done > 0).map(a => a.path);
      expect(allDone).toEqual(['05-completed.md']);
    });

    it('all-open files (done === 0 AND open > 0) — 03 + 07', () => {
      const allOpen = aggregates.filter(a => a.done === 0 && a.open > 0).map(a => a.path).sort();
      expect(allOpen).toEqual(['03-all-open.md', '07-single.md']);
    });
  });

  describe('DataviewJS-shape aggregations (filter by frontmatter)', () => {
    it('finds the only file tagged as "project" — open count is 2', () => {
      const projects = aggregates.filter(a => a.frontmatter?.tag === 'project');
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        path: '09-tagged.md', open: 2, done: 1,
      });
    });

    it('completion ratio: total open ÷ total tasks ≈ 0.529', () => {
      const totalOpen = aggregates.reduce((s, a) => s + a.open, 0);
      const totalTasks = aggregates.reduce((s, a) => s + a.total, 0);
      const ratio = totalOpen / totalTasks;
      expect(ratio).toBeCloseTo(18 / 34, 5);
    });

    it('top-3 files by open-task count: 06-large (5), 10-archived (4), 03-all-open (3)', () => {
      const top3 = aggregates
        .filter(a => a.open > 0)
        .sort((a, b) => b.open - a.open)
        .slice(0, 3)
        .map(a => `${a.path}=${a.open}`);
      expect(top3).toEqual([
        '06-large.md=5',
        '10-archived.md=4',
        '03-all-open.md=3',
      ]);
    });
  });
});
