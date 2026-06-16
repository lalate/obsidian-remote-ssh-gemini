import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Runtime acquisition of the Go daemon binary.
 *
 * The Obsidian community store ships only `main.js` / `manifest.json` /
 * `styles.css`, so the daemon binary can't ride along in the plugin
 * package. Instead we fetch the right per-arch binary from the plugin's
 * GitHub release on first RPC connect, verify it against the release's
 * `daemon-manifest.json` (sha256), and cache it under the plugin folder's
 * `server-bin/`. Subsequent connects hit the local cache.
 *
 * Unsupported remote arches (or download/verify failure) let the caller
 * downgrade to the SFTP transport rather than hard-failing.
 */

export type DaemonOs = 'linux' | 'darwin';
export type DaemonArch = 'amd64' | 'arm64';

export interface DaemonTarget {
  os: DaemonOs;
  arch: DaemonArch;
}

export interface DaemonDownloaderDeps {
  /** Fetch a release asset as bytes (Obsidian `requestUrl` arraybuffer). */
  fetchBinary: (url: string) => Promise<Uint8Array>;
  /** Fetch a release asset as text (the manifest JSON). */
  fetchText: (url: string) => Promise<string>;
  /** Absolute path to the plugin's `server-bin/` cache dir. */
  cacheDir: string;
  /** Persist downloaded bytes to disk and mark executable (chmod +x). */
  writeExecutable: (absPath: string, bytes: Uint8Array) => Promise<void>;
  /** True if a cached file already exists. */
  cacheHit: (absPath: string) => boolean;
  /** `owner/repo` for the release URL. */
  repo: string;
  /**
   * Release tag to fetch from. This is `manifest.version` verbatim, so on
   * the beta channel it carries the pre-release suffix (e.g. `1.1.3-beta.1`)
   * and a GitHub release with exactly that tag must exist and carry the
   * daemon assets.
   */
  version: string;
}

const BINARY_PREFIX = 'obsidian-remote-server';
const MANIFEST_NAME = 'daemon-manifest.json';

export function binaryFilename(t: DaemonTarget): string {
  return `${BINARY_PREFIX}-${t.os}-${t.arch}`;
}

/**
 * Map `uname -s` / `uname -m` output to our release arch tuple. Returns
 * null for anything we don't ship a binary for (Windows server, FreeBSD,
 * 32-bit, …) so the caller downgrades to SFTP.
 */
export function parseUname(unameS: string, unameM: string): DaemonTarget | null {
  const s = unameS.trim().toLowerCase();
  const m = unameM.trim().toLowerCase();
  let os: DaemonOs;
  if (s === 'linux') os = 'linux';
  else if (s === 'darwin') os = 'darwin';
  else return null;
  let arch: DaemonArch;
  if (m === 'x86_64' || m === 'amd64') arch = 'amd64';
  else if (m === 'aarch64' || m === 'arm64') arch = 'arm64';
  else return null;
  return { os, arch };
}

/**
 * Detect the remote host's os/arch via `uname`. Queried as two separate
 * commands (`uname -s`, `uname -m`) because not every remote shell accepts
 * the combined `uname -s -m` form consistently.
 */
export async function detectRemoteTarget(
  exec: (cmd: string) => Promise<string>,
): Promise<DaemonTarget | null> {
  const s = await exec('uname -s');
  const m = await exec('uname -m');
  return parseUname(s, m);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** True when `v` is a plain `{ filename: sha256hex }` string map. */
function isShaManifest(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' && v !== null && !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  );
}

/** Thrown when a downloaded binary fails sha256 verification. */
export class DaemonVerificationError extends Error {}

/**
 * Ensure a local daemon binary for the remote's arch, downloading and
 * verifying from the GitHub release if it isn't already cached. Returns the
 * absolute local path.
 *
 * Throws {@link DaemonVerificationError} on a sha256 mismatch or a missing
 * manifest entry — we never hand back an unverified binary for deployment.
 */
export async function ensureDaemonBinary(
  deps: DaemonDownloaderDeps,
  target: DaemonTarget,
): Promise<string> {
  const filename = binaryFilename(target);
  const dest = path.join(deps.cacheDir, filename);
  if (deps.cacheHit(dest)) return dest;

  const base = `https://github.com/${deps.repo}/releases/download/${deps.version}`;

  const manifestRaw = await deps.fetchText(`${base}/${MANIFEST_NAME}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch (e) {
    throw new DaemonVerificationError(
      `${MANIFEST_NAME} is not valid JSON (release ${deps.version}): ${(e as Error).message}`,
    );
  }
  // Validate the shape rather than trusting an `as` cast: a manifest whose
  // values aren't strings (e.g. an HTTP error body that happened to parse,
  // or a numeric sha) would otherwise reach `.toLowerCase()` and throw a
  // non-DaemonVerificationError that the caller can't classify.
  if (!isShaManifest(parsed)) {
    throw new DaemonVerificationError(
      `${MANIFEST_NAME} is malformed — expected a { filename: sha256 } object (release ${deps.version})`,
    );
  }
  const expected = parsed[filename];
  if (!expected) {
    throw new DaemonVerificationError(
      `${MANIFEST_NAME} has no entry for ${filename} (release ${deps.version})`,
    );
  }

  const bytes = await deps.fetchBinary(`${base}/${filename}`);
  const got = sha256Hex(bytes);
  if (got.toLowerCase() !== expected.toLowerCase()) {
    throw new DaemonVerificationError(
      `daemon binary sha256 mismatch for ${filename}: expected ${expected}, got ${got}`,
    );
  }

  await deps.writeExecutable(dest, bytes);
  return dest;
}

/**
 * Decide whether the daemon auto-download may proceed, persisting the
 * user's choice so the consent prompt is shown at most once (#397).
 *
 * - Already consented → proceed without prompting.
 * - Not yet decided → prompt, then persist the answer. The decline is
 *   persisted too (not just the accept), so "Use SFTP" is durable and
 *   does not re-prompt on every connect / Obsidian restart — the gap
 *   the #406 review flagged.
 *
 * Pure and dependency-injected so the gate is unit-testable without an
 * Obsidian Modal or a live plugin settings harness.
 */
export async function resolveDaemonConsent(
  alreadyConsented: boolean,
  prompt: () => Promise<boolean>,
  persist: (consented: boolean) => Promise<void>,
): Promise<boolean> {
  if (alreadyConsented) return true;
  const consented = await prompt();
  await persist(consented);
  return consented;
}
