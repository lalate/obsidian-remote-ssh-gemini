// Sync `plugin/manifest.json`, the repo-root mirrors `manifest.json`,
// `manifest-beta.json` (BRAT --beta channel), `versions.json`, and
// `plugin/versions.json` with the version that npm has just written
// into `plugin/package.json`.
//
// Wired into `package.json`'s `"version"` lifecycle script so
// `npm version <X.Y.Z>` (run from `plugin/`) updates every file at
// once. The CI version-check workflow asserts they agree.
//
// ─── Branch-aware behaviour (beta vs stable channels) ───────────
//
// `next` (integration / beta) and `main` (stable) form a two-channel
// release model. The version shape selects the channel:
//
//   • `X.Y.Z-beta.N` (beta)   → next: BRAT --beta consumers
//   • `X.Y.Z` (stable)        → main: Obsidian Community Plugins
//
// On a beta bump (suffix detected) we only touch the artefacts that
// the beta channel exposes:
//   • `plugin/manifest.json`     — bundled into the .zip we ship
//   • `manifest-beta.json` (root) — fetched by BRAT --beta from HEAD
//
// We deliberately do NOT touch:
//   • `manifest.json` (root) — Obsidian Community Plugins fetches
//     this from HEAD and must stay pinned to the last stable release
//   • `versions.json` (both) — the stable compatibility map; betas
//     should not appear here or Obsidian's installer will offer them
//     as upgrades to non-BRAT users
//
// On a stable bump (no suffix) we update every file: the new stable
// version supersedes the previous beta on every channel, so
// `manifest-beta.json` is bumped to match `manifest.json` (a stable
// release IS valid for BRAT --beta — it just isn't pre-release).
//
// ─── Why a root mirror exists ────────────────────────────────────
// Obsidian's community plugin browser fetches
// `https://raw.githubusercontent.com/<repo>/HEAD/manifest.json` to
// discover plugin metadata. Plugin source lives under `plugin/` for
// repo-layout reasons (server/, proto/, deploy/ siblings), so we
// mirror to the root so Obsidian — and the obsidianmd/obsidian-releases
// registry validator — can find it.
//
// Manifest version → Obsidian's runtime view of the plugin
//                    (`this.manifest.version` in `main.ts`).
// versions.json    → Obsidian's compatibility map: each stable plugin
//                    version maps to the minimum Obsidian app version
//                    it supports. Betas are intentionally absent.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pluginRoot, '..');

const packagePath = path.join(pluginRoot, 'package.json');
const manifestPath = path.join(pluginRoot, 'manifest.json');
const versionsPath = path.join(pluginRoot, 'versions.json');
const rootManifestPath = path.join(repoRoot, 'manifest.json');
const rootManifestBetaPath = path.join(repoRoot, 'manifest-beta.json');
const rootVersionsPath = path.join(repoRoot, 'versions.json');

const pkg = readJson(packagePath);
const manifest = readJson(manifestPath);
const versions = fs.existsSync(versionsPath) ? readJson(versionsPath) : {};

const newVersion = pkg.version;
// Accept either plain `X.Y.Z` (stable) or `X.Y.Z-beta.N` (prerelease).
// Other prerelease ids (alpha, rc) are rejected so we can't
// accidentally start a fourth channel.
if (typeof newVersion !== 'string'
  || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(newVersion)) {
  console.error(
    `bump-version: package.json has an unexpected version "${newVersion}".`
    + ' Expected X.Y.Z or X.Y.Z-beta.N.',
  );
  process.exit(1);
}

const isBeta = newVersion.includes('-beta.');

manifest.version = newVersion;
writeJson(manifestPath, manifest);

if (isBeta) {
  // Beta-only update: ship the bundled manifest + advertise via BRAT.
  // Leave root manifest.json + versions.json pinned to last stable.
  writeJson(rootManifestBetaPath, manifest);
  console.log(
    `bump-version: BETA — synced plugin/manifest.json + manifest-beta.json `
    + `to ${newVersion}. Stable manifest.json + versions.json unchanged.`,
  );
} else {
  // Stable bump: all files advance together, including the
  // versions.json compatibility map.
  versions[newVersion] = manifest.minAppVersion;
  writeJson(versionsPath, versions);
  writeJson(rootManifestPath, manifest);
  writeJson(rootManifestBetaPath, manifest);
  writeJson(rootVersionsPath, versions);
  console.log(
    `bump-version: STABLE — synced plugin/manifest.json + manifest.json + `
    + `manifest-beta.json + versions.json (plugin + root) to ${newVersion} `
    + `(minAppVersion ${manifest.minAppVersion})`,
  );
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  // Match the existing file's trailing newline convention so diffs
  // stay quiet between editors.
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
