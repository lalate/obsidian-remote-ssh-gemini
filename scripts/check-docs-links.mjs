#!/usr/bin/env node
// Quartz/Obsidian-style wikilink checker for the docs/ tree.
//
// Catches:
//   - broken [[wikilinks]] (target file does not exist)
//   - bad anchor refs ([[page#Heading]] where the heading does not exist)
//   - orphan pages (no inbound wikilinks; index.md is exempted)
//
// Resolution rules match Quartz's "shortest-path" wikilink behaviour:
//   - [[foo/bar]]  -> resolves against docs/foo/bar.md
//   - [[bar]]      -> resolves against any docs/**/bar.md (basename match)
//   - [[en/foo|x]] -> alias is stripped; \| (escaped pipe in tables) handled
//
// Code spans (`...`) and fenced blocks (```...```) are stripped before
// scanning so wikilink-syntax illustrations in the contributing guide
// are not flagged as broken links.
//
// Exit code: 0 = clean, 1 = at least one broken wikilink or bad anchor.
// Orphan pages are reported but do NOT fail the run by default.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'docs';
// Scan the whole docs/ tree so per-language subtrees (en/, ja/, …) are all checked.
const SCAN_ROOT = ROOT;

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name.endsWith('.md')) files.push(p);
  }
  return files;
}

const norm = (s) => s.split(path.sep).join('/');

function stripCode(src) {
  return src
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function slugify(s) {
  // Quartz/Obsidian-style: keep Unicode letters + digits so JA / CJK
  // / accented headings produce distinct slugs instead of all
  // collapsing to '' (which would silently match any anchor against
  // any heading on the page). NFC-normalise so visually identical
  // strings with different Unicode encodings hash to the same slug.
  return s
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s\-]/gu, '')
    .replace(/\s+/g, '-');
}

function parseTarget(raw) {
  const pipeMatch = raw.match(/^(.+?)\\?\|/);
  let target = (pipeMatch ? pipeMatch[1] : raw).trim();
  let anchor = '';
  const hashIdx = target.indexOf('#');
  if (hashIdx >= 0) {
    anchor = target.slice(hashIdx + 1).trim();
    target = target.slice(0, hashIdx).trim();
  }
  return { target, anchor };
}

const allMd = walk(ROOT);
const existingByPath = new Set(allMd.map((f) => norm(f).replace(/\.md$/, '')));
const byBasename = new Map();
for (const p of existingByPath) {
  const base = p.split('/').pop();
  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(p);
}

const headings = new Map();
for (const file of allMd) {
  const key = norm(file).replace(/\.md$/, '');
  const set = new Set();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m) set.add(slugify(m[1]));
  }
  headings.set(key, set);
}

function resolveTarget(target, fromFile) {
  if (!target) return norm(fromFile).replace(/\.md$/, '');
  if (target.includes('/')) {
    const candidate = `${ROOT}/${target}`;
    return existingByPath.has(candidate) ? candidate : null;
  }
  if (byBasename.has(target)) return byBasename.get(target)[0];
  return null;
}

const wikilinkRe = /\[\[([^\[\]]+?)\]\]/g;

const broken = [];
const badAnchors = [];
const inbound = new Map();
for (const p of existingByPath) inbound.set(p, 0);

for (const file of walk(SCAN_ROOT)) {
  const content = stripCode(fs.readFileSync(file, 'utf8'));
  const fileKey = norm(file).replace(/\.md$/, '');
  let m;
  while ((m = wikilinkRe.exec(content)) !== null) {
    const { target, anchor } = parseTarget(m[1]);
    if (!target && !anchor) continue;
    const resolved = resolveTarget(target, file);
    if (!resolved) {
      broken.push({ file: norm(file), link: m[0], target });
      continue;
    }
    if (resolved !== fileKey) {
      inbound.set(resolved, (inbound.get(resolved) || 0) + 1);
    }
    if (anchor) {
      const slug = slugify(anchor);
      const set = headings.get(resolved);
      if (!set || !set.has(slug)) {
        badAnchors.push({ file: norm(file), link: m[0], expectedSlug: slug, in: resolved });
      }
    }
  }
}

const orphans = [];
// Skip per-language root landings (docs/<lang>/index.md) — they are reached via
// the folder URL / language switcher, not via wikilink, so a 0 inbound count
// is expected and not a bug.
const isLangRoot = (p) => /^docs\/[a-z]{2}(?:-[A-Z]{2})?\/index$/.test(p);
for (const [p, count] of inbound.entries()) {
  if (!p.startsWith('docs/')) continue;
  if (p === 'docs/index') continue; // top-level redirect page
  if (isLangRoot(p)) continue;
  if (count === 0) orphans.push(p + '.md');
}
orphans.sort();

console.log(`docs link check: ${broken.length} broken wikilinks, ${badAnchors.length} bad anchors, ${orphans.length} orphan pages.`);

if (broken.length) {
  console.log('\n--- Broken wikilinks ---');
  for (const b of broken) {
    console.log(`  ${b.file}  ->  ${b.link}  (target "${b.target}" not found)`);
  }
}

if (badAnchors.length) {
  console.log('\n--- Bad anchor references ---');
  for (const b of badAnchors) {
    console.log(`  ${b.file}  ->  ${b.link}  (slug "${b.expectedSlug}" not in ${b.in}.md)`);
  }
}

if (orphans.length) {
  console.log('\n--- Orphan pages (no inbound wikilinks) ---');
  for (const o of orphans) console.log(`  ${o}`);
}

process.exit(broken.length + badAnchors.length > 0 ? 1 : 0);
