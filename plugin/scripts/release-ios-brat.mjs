#!/usr/bin/env node

// One-shot iOS BRAT release: bumps version, builds, commits, pushes, creates prerelease.
// Usage (from plugin/):
//   npm run release:ios:brat [commit-message-suffix]
//
// Examples:
//   npm run release:ios:brat
//   npm run release:ios:brat "fix: relay retry on transient failure"

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pluginRoot, '..');

const messageSuffix = process.argv[2] || '';
const packagePath = path.join(pluginRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const cwd = { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' };
const pluginCwd = { cwd: pluginRoot, stdio: 'inherit', shell: process.platform === 'win32' };

console.log(`📱 iOS BRAT Release Pipeline\n`);

// 1. Bump version
console.log(`[1/5] Bumping manifest version...`);
execSync('npm run bump:ios:brat', pluginCwd);

// 2. Build
console.log(`\n[2/5] Building plugin...`);
execSync('npm run build', pluginCwd);

// Get the new version
const newPkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const newVersion = newPkg.version;
console.log(`✅ Version bumped to ${newVersion}`);

// 3. Git commit
console.log(`\n[3/5] Committing changes...`);
const commitMsg = messageSuffix
  ? `feat(mobile): iOS BRAT release ${newVersion}\n\n${messageSuffix}`
  : `feat(mobile): iOS BRAT release ${newVersion}`;

try {
  execSync(`git add plugin/src/main.ts plugin/src/settings/MobileSettingsTab.ts plugin/package.json manifest.json manifest-beta.json plugin/manifest.json plugin/manifest-beta.json plugin/main.js plugin/styles.css 2>/dev/null || true`, cwd);
  execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, cwd);
  console.log(`✅ Committed: ${newVersion}`);
} catch (e) {
  // If nothing to commit, that's okay
  console.log(`⚠️  Nothing new to commit (or already committed)`);
}

// 4. Git push
console.log(`\n[4/5] Pushing to origin/next...`);
execSync('git push origin next', cwd);
console.log(`✅ Pushed to origin/next`);

// 5. Create release
console.log(`\n[5/5] Creating GitHub prerelease...`);
const assetFiles = [
  'plugin/main.js',
  'plugin/manifest.json',
  'plugin/manifest-beta.json',
  'plugin/styles.css',
];
const releaseCmd = `gh release create ${newVersion} ${assetFiles.join(' ')} --prerelease --title "${newVersion}" --notes "iOS BRAT prerelease\n\nSee commit history for details."`;
execSync(releaseCmd, cwd);
console.log(`✅ Created prerelease: https://github.com/$(git config --get remote.origin.url | sed 's/.*://;s/.git$//')/releases/tag/${newVersion}`);

console.log(`\n🎉 iOS BRAT release ${newVersion} complete!\n`);
