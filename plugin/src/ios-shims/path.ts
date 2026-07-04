/**
 * Pure-JS reimplementation of Node.js `path` posix API for iOS.
 *
 * iOS (JavaScriptCore) has no built-in `path` module, but many Obsidian
 * plugin utilities depend on POSIX-style path string manipulation. This
 * shim provides the subset of `path.posix` methods the codebase actually
 * calls — all pure string operations, no native bindings.
 */

const sep = '/';
const delimiter = ':';

function normalize(p: string): string {
  if (!p) return '.';
  const isAbsolute = p.startsWith('/');
  const parts = p.split('/').filter(Boolean);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push('..');
      }
      continue;
    }
    stack.push(part);
  }

  const result = stack.join('/');
  if (isAbsolute) return '/' + result;
  return result || '.';
}

function join(...parts: string[]): string {
  const filtered = parts.filter(p => p !== '');
  if (filtered.length === 0) return '.';
  return normalize(filtered.join('/'));
}

function resolve(...parts: string[]): string {
  let resolved = '';
  let resolvedAbsolute = false;

  for (let i = parts.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const part = parts[i];
    if (!part) continue;
    resolved = part + '/' + resolved;
    resolvedAbsolute = part.startsWith('/');
  }

  if (!resolvedAbsolute) {
    resolved = '/' + resolved;
    resolvedAbsolute = true;
  }

  resolved = normalize(resolved);
  return resolved || '/';
}

function dirname(p: string): string {
  if (!p) return '.';
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

function basename(p: string, ext?: string): string {
  if (!p) return '';
  const i = p.lastIndexOf('/');
  let base = i === -1 ? p : p.slice(i + 1);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

function extname(p: string): string {
  if (!p) return '';
  const base = basename(p);
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i);
}

function relative(from: string, to: string): string {
  from = resolve(from);
  to = resolve(to);
  if (from === to) return '';

  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);

  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }

  const up = fromParts.slice(i).map(() => '..');
  const down = toParts.slice(i);
  const result = [...up, ...down].join('/');
  return result || '.';
}

function parse(p: string) {
  const root = p.startsWith('/') ? '/' : '';
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  return { root, dir, base, ext, name };
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  isAbsolute,
};

export const posix = {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  isAbsolute,
};

export const win32 = {
  sep: '\\',
  delimiter: ';',
  normalize: normalize,
  join: join,
  resolve: resolve,
  dirname: dirname,
  basename: basename,
  extname: extname,
  relative: relative,
  parse: parse,
  isAbsolute: (p: string) => /^[a-zA-Z]:\\/.test(p),
};

export default { sep, delimiter, normalize, join, resolve, dirname, basename, extname, relative, parse, isAbsolute, posix, win32 };
