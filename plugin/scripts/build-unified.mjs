import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const mainJs = resolve(root, 'main.js');
const outDir = resolve(root, 'build-artifacts');

const runNode = (script, arg) => {
  execFileSync('node', [script, arg], { cwd: root, stdio: 'inherit' });
};

runNode('esbuild.config.mjs', 'production');
const desktopBundle = readFileSync(mainJs);

runNode('esbuild.ios.mjs', 'production');
const iosBundle = readFileSync(mainJs);

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'main.desktop.js'), desktopBundle);
writeFileSync(resolve(outDir, 'main.ios.js'), iosBundle);

writeFileSync(mainJs, desktopBundle);
copyFileSync(mainJs, resolve(outDir, 'main.js'));
