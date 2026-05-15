#!/usr/bin/env node
import esbuild from 'esbuild';

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'events', 'fs', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'readline', 'stream', 'string_decoder', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

function normalize(specifier) {
  return specifier.startsWith('node:') ? specifier.slice(5) : specifier;
}

function extractImportPath(text) {
  const quoted = text.match(/\"([^\"]+)\"|'([^']+)'/);
  if (!quoted) return null;
  return quoted[1] ?? quoted[2] ?? null;
}

async function main() {
  try {
    await esbuild.build({
      entryPoints: ['src/main.ts'],
      absWorkingDir: process.cwd(),
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
      logLevel: 'silent',
    });
    console.log('mobile-activation-check: PASS (no Node builtin import required at startup)');
    process.exit(0);
  } catch (error) {
    const errors = Array.isArray(error?.errors) ? error.errors : [];
    const offenders = new Set();

    for (const e of errors) {
      const importPath = extractImportPath(e.text || '');
      const normalized = importPath ? normalize(importPath) : null;
      if (normalized && NODE_BUILTINS.has(normalized)) {
        const where = e.location?.file ? `${e.location.file}:${e.location.line}` : 'unknown';
        offenders.add(`${normalized} @ ${where}`);
      }
    }

    if (offenders.size === 0) {
      console.error('mobile-activation-check: FAIL');
      for (const e of errors) {
        console.error(`- ${e.text}`);
      }
      process.exit(1);
    }

    console.error('mobile-activation-check: FAIL (Node builtins in startup graph)');
    for (const line of [...offenders].sort()) {
      console.error(`- ${line}`);
    }
    console.error('hint: move desktop-only imports behind runtime guards and dynamic import().');
    process.exit(1);
  }
}

main();


