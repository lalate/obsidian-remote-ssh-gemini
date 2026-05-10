// Promotion helper: drop the `-beta.N` suffix from the current
// `plugin/package.json` version and run `npm version <stripped>` so
// the bump-version.mjs hook sees a plain stable version and updates
// every manifest accordingly.
//
// Usage (from plugin/):
//   npm run bump:stable
//
// Examples:
//   1.0.44-beta.5  →  1.0.44   (cycle close — ready for promotion)
//   1.0.44         →  error    (already stable; use `npm version patch`)
//
// Why a separate script instead of `npm version patch`:
//   `npm version patch` from `1.0.44-beta.5` produces `1.0.45`,
//   skipping the planned `1.0.44` stable. This helper preserves the
//   `X.Y.Z` core that the beta cycle was leading up to.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const packagePath = path.join(pluginRoot, 'package.json');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const current = pkg.version;
const m = /^(\d+\.\d+\.\d+)-beta\.\d+$/.exec(current);

if (!m) {
  console.error(
    `bump-stable: current version "${current}" is not a beta `
    + `(expected X.Y.Z-beta.N). Use 'npm version patch' for a stable bump.`,
  );
  process.exit(1);
}

const stable = m[1];
console.log(`bump-stable: ${current} → ${stable}`);

// `npm version <X.Y.Z> --no-git-tag-version` writes package.json,
// runs the `version` lifecycle hook (which calls bump-version.mjs),
// and stages everything per the script in package.json.
execFileSync('npm', ['version', stable, '--no-git-tag-version'], {
  cwd: pluginRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
