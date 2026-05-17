import * as path from 'path';

export function posixJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export function relativeTo(base: string, full: string): string {
  if (!full.startsWith(base)) return full;
  return full.slice(base.endsWith('/') ? base.length : base.length + 1);
}

export function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

export function toLocalPath(localBase: string, relativePath: string): string {
  return path.join(localBase, relativePath);
}

export function toRemotePath(remoteBase: string, relativePath: string): string {
  return posixJoin(remoteBase, relativePath);
}

export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, p.slice(2));
  }
  return p;
}

/**
 * Normalize a remote path before sending it to SFTP.
 * - SFTP servers (OpenSSH) do not expand `~`; the SFTP working directory at
 *   session start is already the user's home, so `~/foo/bar` is rewritten as
 *   the home-relative `foo/bar`.
 * - A bare `~` is rewritten as `.` (current dir = home).
 * - Trailing slashes are trimmed (except for the root `/`) so that joining
 *   the base with vault-relative subpaths produces a single separator.
 */
export function normalizeRemotePath(p: string): string {
  let r = p.trim();
  if (r.startsWith('~/')) r = r.slice(2);
  else if (r === '~') r = '.';
  while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

/**
 * Compare two ABSOLUTE remote (POSIX) paths for equality, tolerant of
 * a trailing slash. Used to decide whether a reused RPC daemon's
 * `ServerInfo.vaultRoot` matches the vault root the current profile
 * needs — if it doesn't, the daemon is stale (the profile's
 * remotePath changed, or the old root was deleted) and must be
 * killed + redeployed instead of silently serving the wrong/missing
 * tree.
 *
 * Both sides are POSIX-normalised (`.`, `..`, `//`, trailing slash)
 * before comparison: the client computes the wanted root by string
 * join (`resolveRemotePath`) while the daemon reports its root via
 * Go's `filepath.Abs`, which collapses `.`/`..`/`//`. Without
 * normalisation, remotePath `~` (→ `/home/u/.`) vs the daemon's
 * `/home/u` is a permanent false-mismatch → kill+redeploy on every
 * connect. An empty/blank input (older daemon omitting the field,
 * or `undefined`) never matches a real root — that intentionally
 * forces a redeploy, which is the safe outcome.
 *
 * Still strict otherwise: a false "match" reattaches to a daemon
 * serving the wrong root (the field bug — empty vault, every op
 * `no such file`). A spurious redeploy is *safe* but not free — it
 * costs a full pkill + binary upload + daemon restart (seconds on a
 * slow link) — so the normalisation above exists to avoid firing it
 * on legitimately-equal paths, not to make redeploy cheap.
 */
export function sameRemotePath(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string | undefined): string => {
    const t = (s ?? '').trim();
    if (t === '') return '';
    let r = path.posix.normalize(t);
    while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
    return r;
  };
  const na = norm(a);
  const nb = norm(b);
  // Empty (missing/blank root) must never count as a match, not even
  // empty-vs-empty — it always means "can't trust this, redeploy".
  if (na === '' || nb === '') return false;
  return na === nb;
}
