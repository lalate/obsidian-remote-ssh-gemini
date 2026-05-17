import { test, expect } from '@playwright/test';
import * as net from 'node:net';
import {
  launchObsidian,
  driveConnectFlow,
  findShadowVaultPath,
  type ObsidianHandle,
} from './helpers/obsidian';
import { scaffoldTestVault, type ScaffoldResult } from './helpers/vault-scaffold';
import { logPathFor, waitForLog, assertAtMost } from './helpers/log-oracle';

/**
 * Connect-lifecycle e2e — the coverage that was missing while a
 * broken connect shipped to stable (1.0.49).
 *
 * Every prior spec "gracefully skips if sshd is unreachable" and only
 * asserts that *something* appeared — so a connect that opens SFTP
 * then stalls in `AdapterManager.patch` / `runAutoConnect` /
 * `populateVaultFromRemote` (the exact production incident: SFTP
 * channel open, then no patch/populate logs, then a WindowSpawner
 * re-spawn loop) passed CI green. This spec is deliberately the
 * opposite:
 *
 *   - HARD FAIL, never skip. sshd down ⇒ test failure, not a skip.
 *   - Drives the FULL real lifecycle in real Obsidian over SFTP
 *     (the transport the incident was reported on):
 *       scaffold → Connect → shadow spawn → shadow window
 *       auto-connect → AdapterManager.patch → runAutoConnect →
 *       populateVaultFromRemote.
 *   - Asserts the structured-log trail that was *absent* in the
 *     incident, AND bounds the WindowSpawner count that was *runaway*.
 *
 * Expected to be RED on the current build (reproduces the incident),
 * GREEN once the connect orchestration is fixed. That ordering is the
 * point — the test proves the fix, and guards the regression.
 */

const SSHD_HOST = '127.0.0.1';
const SSHD_PORT = 2222;

test.setTimeout(240_000);

async function assertSshdReachable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sock = net
      .connect({ host: SSHD_HOST, port: SSHD_PORT })
      .setTimeout(5_000)
      .once('connect', () => { sock.destroy(); resolve(); })
      .once('timeout', () => { sock.destroy(); reject(new Error('timeout')); })
      .once('error', reject);
  }).catch((e) => {
    throw new Error(
      `docker test sshd not reachable at ${SSHD_HOST}:${SSHD_PORT} ` +
      `(${(e as Error).message}). Run \`npm run sshd:start\` first. ` +
      `This spec HARD-FAILS instead of skipping — a broken connect ` +
      `must not pass CI green (that is how 1.0.49 shipped broken).`,
    );
  });
}

test.describe('connect lifecycle (SFTP)', () => {
  let scaffold: ScaffoldResult;
  let scaffoldHandle: ObsidianHandle | null = null;
  let shadowHandle: ObsidianHandle | null = null;

  test.beforeAll(async () => {
    await assertSshdReachable();
    scaffold = scaffoldTestVault({ transport: 'sftp' });
  });

  test.afterAll(async () => {
    try { await shadowHandle?.cleanup(); } catch { /* best effort */ }
    try { await scaffoldHandle?.cleanup(); } catch { /* best effort */ }
    scaffold?.cleanup();
  });

  test('Connect → patch → runAutoConnect → populate completes end-to-end over SFTP', async () => {
    // 1. Real Obsidian on the scaffold vault, plugin force-loaded.
    scaffoldHandle = await launchObsidian(scaffold.vaultPath);

    // 2. Drive the real Connect command; the plugin bootstraps a
    //    shadow vault and registers it in obsidian.json.
    await driveConnectFlow(scaffoldHandle.page);
    const shadowVaultPath = await findShadowVaultPath(scaffold.vaultPath, 20_000);

    // 3. The connecting (scaffold) window must NOT be stuck
    //    re-bootstrapping/re-spawning the shadow — the production
    //    symptom was dozens of these within milliseconds.
    assertAtMost(
      logPathFor(scaffold.vaultPath),
      /WindowSpawner: firing obsidian:\/\/open/,
      3,
      'scaffold window must not loop-spawn the shadow vault',
    );

    // 4. Hand off to a fresh Obsidian on the shadow vault — this is
    //    the window that auto-connects (runAutoConnect on layout).
    await scaffoldHandle.cleanup();
    scaffoldHandle = null;
    shadowHandle = await launchObsidian(shadowVaultPath);
    const shadowLog = logPathFor(shadowVaultPath);

    // 5. The post-SFTP-open orchestration that was SILENT in the
    //    incident MUST produce its trail:
    //    a) SSH/SFTP actually opened
    await waitForLog(
      shadowLog,
      /SFTP channel open/,
      60_000,
      'SFTP channel must open',
    );
    //    b) the adapter was patched over the SFTP transport
    await waitForLog(
      shadowLog,
      /Adapter patched via SFTP/,
      60_000,
      'adapter must patch after SFTP open (absent in the incident)',
    );
    //    c) the remote tree was actually walked into the vault model
    await waitForLog(
      shadowLog,
      /populateVaultFromRemote\(shadow-[^)]*\):.*entries/,
      90_000,
      'vault must populate from remote (absent in the incident)',
    );

    // 6. And the shadow window must not itself be loop-spawning.
    assertAtMost(
      shadowLog,
      /WindowSpawner: firing obsidian:\/\/open/,
      2,
      'shadow window must not loop-spawn',
    );

    // 7. Observable end state: File Explorer shows remote content.
    //    (The remote docker vault is the integration fixture tree.)
    const fileExplorerHasEntries = await shadowHandle.page
      .locator('.nav-files-container .nav-file-title')
      .first()
      .isVisible({ timeout: 30_000 })
      .catch(() => false);
    expect(
      fileExplorerHasEntries,
      'File Explorer should render remote files after populate',
    ).toBe(true);
  });
});
