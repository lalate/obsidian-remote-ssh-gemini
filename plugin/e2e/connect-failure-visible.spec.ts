import { test, expect } from '@playwright/test';
import * as net from 'node:net';
import {
  launchObsidian,
  driveConnectFlow,
  findShadowVaultPath,
  type ObsidianHandle,
} from './helpers/obsidian';
import { scaffoldTestVault, type ScaffoldResult } from './helpers/vault-scaffold';
import {
  logPathFor,
  waitForLog,
  assertAtMost,
  countLog,
} from './helpers/log-oracle';

/**
 * Negative-path connect e2e — guards the ACTUAL field incident.
 *
 * Root-cause of the "1.0.49 broke connect" report was NOT a code
 * regression: a profile pointed at a remotePath that doesn't exist on
 * the remote, so connect legitimately failed — but
 * `runAutoConnect`'s failure was only `logger.warn`'d (invisible to a
 * user looking at the still-focused source window) and
 * `openShadowVaultFor` had no re-entrancy guard, so impatient
 * re-clicks produced a WindowSpawner churn that *looked* like a hang.
 *
 * This spec scaffolds exactly that situation (sftp + non-existent
 * remotePath) and asserts the fixed contract:
 *
 *   - connect FAILS (it must — the path is bogus) and that failure is
 *     RECORDED visibly in the log (not a silent hang);
 *   - it does NOT proceed to patch/populate (no false "connected");
 *   - it does NOT spawn-storm.
 *
 * HARD-FAILS if sshd is unreachable — same rationale as the happy
 * path: a connect-path spec that silently skips is how the incident
 * shipped green.
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
      `(${(e as Error).message}). Run \`npm run sshd:start\` first.`,
    );
  });
}

test.describe('connect failure is visible (bad remotePath, SFTP)', () => {
  let scaffold: ScaffoldResult;
  let scaffoldHandle: ObsidianHandle | null = null;
  let shadowHandle: ObsidianHandle | null = null;

  test.beforeAll(async () => {
    await assertSshdReachable();
    // sshd is up and reachable, but this path does NOT exist in the
    // docker fixture — connect must fail at the remote-path check.
    scaffold = scaffoldTestVault({
      transport: 'sftp',
      remotePath: '/home/tester/this-path-does-not-exist',
    });
  });

  test.afterAll(async () => {
    try { await shadowHandle?.cleanup(); } catch { /* best effort */ }
    try { await scaffoldHandle?.cleanup(); } catch { /* best effort */ }
    scaffold?.cleanup();
  });

  test('a bad remotePath fails visibly — no silent hang, no spawn storm, no false connect', async () => {
    scaffoldHandle = await launchObsidian(scaffold.vaultPath);

    await driveConnectFlow(scaffoldHandle.page);
    const shadowVaultPath = await findShadowVaultPath(scaffold.vaultPath, 20_000);

    // C2 guard: one Connect drive must not have produced a spawn storm
    // in the source window.
    assertAtMost(
      logPathFor(scaffold.vaultPath),
      /WindowSpawner: firing obsidian:\/\/open/,
      3,
      'source window must not loop-spawn on a single Connect',
    );

    await scaffoldHandle.cleanup();
    scaffoldHandle = null;
    shadowHandle = await launchObsidian(shadowVaultPath);
    const shadowLog = logPathFor(shadowVaultPath);

    // The failure MUST be recorded — connect either fails outright or
    // runAutoConnect's guard fires. Either way it is visible in the
    // log within budget, not an unbounded silent wait.
    await waitForLog(
      shadowLog,
      /Connect failed|did not reach CONNECTED state|auto-connect to .* failed/,
      90_000,
      'a bad remotePath must fail VISIBLY (logged), not hang silently',
    );

    // It must NOT have lied about success: no patch, no populate.
    expect(
      countLog(shadowLog, /Adapter patched via/),
      'a failed connect must not patch the adapter',
    ).toBe(0);
    expect(
      countLog(shadowLog, /populateVaultFromRemote\([^)]*\):.*entries/),
      'a failed connect must not populate the vault',
    ).toBe(0);

    // And the shadow window itself must not spawn-storm.
    assertAtMost(
      shadowLog,
      /WindowSpawner: firing obsidian:\/\/open/,
      2,
      'shadow window must not loop-spawn on a failed connect',
    );
  });
});
