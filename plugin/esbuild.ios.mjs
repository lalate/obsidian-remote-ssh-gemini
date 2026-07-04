/**
 * iOS-specific esbuild config.
 *
 * Builds main.js from ios-entry.ts with Node built-in modules (fs, path, os)
 * aliased to pure-JS stubs that work on iOS (JavaScriptCore).
 *
 * Usage:  node esbuild.ios.mjs [production]
 */
import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const prod = process.argv[2] === 'production';

const aliasPlugin = {
  name: 'ios-shims',
  setup(build) {
    // Redirect Node built-ins to iOS-compatible shims
    const shimsDir = new URL('./src/ios-shims/', import.meta.url).pathname;
    const shimMap = {
      'fs': 'fs.ts',
      'path': 'path.ts',
      'os': 'os.ts',
      'http': 'http.ts',
      'crypto': 'crypto.ts',
      'events': 'events.ts',
      'node:fs': 'fs.ts',
      'node:fs/promises': 'fs-promises.ts',
      'node:path': 'path.ts',
      'node:os': 'os.ts',
      'node:http': 'http.ts',
      'node:crypto': 'crypto.ts',
      'node:events': 'events.ts',
    };
    for (const [mod, shim] of Object.entries(shimMap)) {
      build.onResolve({ filter: new RegExp(`^${mod.replace(/:/, '\\:')}$`) }, args => ({
        path: shimsDir + shim,
      }));
    }
  },
};

// Reuse the BigInt probe stripper from the main build
const stripSsh2BigIntProbe = (file) => {
  const PROBE = 'new Function("return 2n ** 32n")()';
  const code = readFileSync(file, 'utf8');
  if (!code.includes(PROBE)) {
    console.warn(`esbuild ios: BigInt probe not found — ssh2 may not be bundled or has changed`);
    return;
  }
  writeFileSync(file, code.replaceAll(PROBE, '(2n ** 32n)'));
  console.log('esbuild ios: stripped ssh2 BigInt new Function probe');
};

esbuild.build({
  entryPoints: ['src/ios-entry.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    'cpu-features',
    'nan',
    // fs, path, os are handled by aliasPlugin instead of being external
  ],
  plugins: [aliasPlugin],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  mainFields: ['module', 'main'],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  outfile: 'main.js',
}).then(() => {
  stripSsh2BigIntProbe('main.js');
  console.log('esbuild ios: build complete');
}).catch((err) => {
  console.error('esbuild ios build failed:', err);
  process.exit(1);
});
