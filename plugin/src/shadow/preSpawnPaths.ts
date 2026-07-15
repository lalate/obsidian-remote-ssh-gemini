import type { PathMapper } from '../path/PathMapper';

/**
 * Resolve a vault-relative `.obsidian/…` path to the absolute remote path
 * the pre-spawn config pull must read, applying the SAME per-client
 * redirect the shadow window's adapter uses.
 *
 * Load-bearing: the four per-device config files (`app.json`,
 * `appearance.json`, `core-plugins.json`, `hotkeys.json`) must resolve to
 * `<configDir>/user/<clientId>/…`, NOT the dead shared identity path — the
 * pre-spawn pull previously joined the bare remote base and read the shared
 * path, clobbering the redirected per-device config on every spawn (#450
 * CRITICAL). `PathMapper.toRemote` is identity for non-private paths, so
 * `community-plugins.json` / `plugins/*` stay shared, unchanged.
 *
 * Extracted as a pure function so this redirect is unit-testable without
 * standing up `preSpawnPull`'s standalone `SftpClient`.
 */
export function preSpawnRemotePath(
  mapper: PathMapper,
  remoteBase: string,
  vaultRelPath: string,
): string {
  const mapped = mapper.toRemote(vaultRelPath);
  return remoteBase === '.' ? mapped : `${remoteBase}/${mapped}`;
}
