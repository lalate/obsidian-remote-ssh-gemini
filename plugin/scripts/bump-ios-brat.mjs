import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pluginRoot, '..');

const targets = [
  path.join(pluginRoot, 'manifest.json'),
  path.join(pluginRoot, 'manifest-beta.json'),
  path.join(repoRoot, 'manifest.json'),
  path.join(repoRoot, 'manifest-beta.json'),
];

const requested = process.argv[2]?.trim();
const current = readJson(targets[0]).version;

const next = requested && requested.length > 0
  ? requested
  : incrementIosVersion(current);

if (!/^\d+\.\d+\.\d+-ios\.\d+$/.test(next)) {
  console.error(`bump-ios-brat: invalid target version "${next}" (expected X.Y.Z-ios.N)`);
  process.exit(1);
}

for (const file of targets) {
  const data = readJson(file);
  data.version = next;
  writeJson(file, data);
}

console.log(`bump-ios-brat: ${current} -> ${next}`);
console.log('updated:');
for (const file of targets) {
  console.log(`- ${path.relative(repoRoot, file).replace(/\\/g, '/')}`);
}

function incrementIosVersion(v) {
  const m = /^(\d+\.\d+\.\d+)-ios\.(\d+)$/.exec(v);
  if (!m) {
    console.error(`bump-ios-brat: current version "${v}" is not X.Y.Z-ios.N; pass target explicitly`);
    process.exit(1);
  }
  return `${m[1]}-ios.${Number(m[2]) + 1}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}
