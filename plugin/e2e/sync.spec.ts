import { test, expect } from '@playwright/test';
import {
  launchObsidian,
  connectAndOpenShadow,
  runCommandViaPalette,
  type ObsidianHandle,
} from './helpers/obsidian';
import { scaffoldTestVault, type ScaffoldResult } from './helpers/vault-scaffold';
import { RemoteVerifier } from './helpers/remote-verifier';
import { assertSshdReachable } from './helpers/sshd';

/**
 * E2E sync tests — verify that local Obsidian operations (create,
 * edit, delete) propagate to the remote filesystem.
 *
 * These tests require:
 *   - Docker test sshd running (`npm run sshd:start`)
 *   - Plugin + server built
 *   - Obsidian installed
 *
 * The test connects to the remote vault, performs file operations
 * via the Obsidian UI, then checks the remote filesystem directly
 * via a separate SFTP connection (RemoteVerifier) to confirm the
 * changes landed.
 *
 * This suite HARD-FAILS — it never skips. It used to `test.skip` both
 * when sshd was down and when `connectAndOpenShadow` THREW, so a
 * genuinely broken connect reported CI green: exactly the failure mode
 * `helpers/sshd.ts` exists to stop ("that is how 1.0.49 shipped
 * broken"). The connect-* specs were migrated to `assertSshdReachable`;
 * this spec and `reflect.spec.ts` were left behind. Not any more.
 */

let obsidian: ObsidianHandle;
let scaffold: ScaffoldResult;
let remote: RemoteVerifier;

const STAMP = Date.now().toString(36);
const TEST_NOTE = `e2e-test-${STAMP}.md`;
const TEST_CONTENT_INITIAL = `# E2E Test Note\n\nCreated by sync.spec.ts at ${STAMP}\n`;
const TEST_CONTENT_EDITED = `# E2E Test Note (edited)\n\nEdited by sync.spec.ts at ${STAMP}\n`;

test.beforeAll(async () => {
  // HARD-FAIL, never skip: a down sshd is a broken harness and a broken
  // connect is a broken plugin. Both must be red, not green-by-skipping.
  await assertSshdReachable();

  remote = new RemoteVerifier();
  const remoteOk = await remote.connect();
  if (!remoteOk) {
    throw new Error(
      'RemoteVerifier could not connect to the docker test sshd even though ' +
      'the port is open — check the test key / container state. This spec ' +
      'hard-fails rather than skipping.',
    );
  }

  scaffold = scaffoldTestVault();
  obsidian = await launchObsidian(scaffold.vaultPath);

  // connectAndOpenShadow drives palette → "Remote SSH: Connect" →
  // passphrase modal Connect button → reads obsidian.json for the
  // new shadow vault entry → relaunches our managed Obsidian on
  // the shadow vault path. The returned handle's `page` is now
  // attached to the shadow window (the only one with remote files
  // visible). The previous heuristic — `connected = items > 0` —
  // returned true on the scaffold's seeded local_demo*.md even
  // when the connect command was a silent no-op.
  //
  // Deliberately NOT wrapped in try/catch: if the connect flow throws,
  // the plugin is broken and this suite must go RED. Swallowing it into
  // a `test.skip` is what let a broken connect ship green.
  obsidian = await connectAndOpenShadow(obsidian, scaffold.vaultPath);
});

test.afterAll(async () => {
  // Clean up test files on remote
  if (remote) {
    await remote.removeFile(TEST_NOTE).catch(() => {});
    await remote.disconnect();
  }
  await obsidian?.cleanup();
  scaffold?.cleanup();
});

test.describe('Remote sync verification', () => {
  // No `beforeEach` skip gate: reaching here means `beforeAll` completed,
  // which means the connect succeeded. If it didn't, beforeAll threw and
  // the whole suite is already red — which is the point.

  test('create — new note appears on remote', async () => {
    const { page } = obsidian;

    // Create a new note via command palette (hardened against CI's
    // racy palette wiring — the fixed-sleep version timed the whole
    // test out at 120s in run 26015295742).
    await runCommandViaPalette(page, 'Create new note');
    await page.waitForTimeout(1_000);

    // Type the filename in the title area
    // Obsidian focuses the inline title after creating a new note
    const inlineTitle = page.locator('.inline-title');
    if (await inlineTitle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await inlineTitle.fill(TEST_NOTE.replace('.md', ''));
      await page.keyboard.press('Enter');
    }

    // Type content in the editor
    const editor = page.locator('.cm-editor .cm-content');
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    await page.keyboard.type(TEST_CONTENT_INITIAL);

    // Wait for the write to propagate to remote
    await page.waitForTimeout(5_000);

    // Verify on remote
    const exists = await remote.exists(TEST_NOTE);
    expect(exists).toBe(true);

    const content = await remote.readFile(TEST_NOTE);
    expect(content).toContain('E2E Test Note');
    expect(content).toContain(STAMP);
  });

  test('edit — modified content reflects on remote', async () => {
    const { page } = obsidian;

    // The note from the create test should still be open.
    // Select all and replace content.
    const editor = page.locator('.cm-editor .cm-content');
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(TEST_CONTENT_EDITED);

    // Wait for the write to propagate
    await page.waitForTimeout(5_000);

    // Verify on remote
    const content = await remote.readFile(TEST_NOTE);
    expect(content).toContain('edited');
  });

  test('delete — removed note disappears from remote', async () => {
    const { page } = obsidian;

    // Delete the current note via command palette (hardened — see
    // the create test).
    await runCommandViaPalette(page, 'Delete current file');

    // Obsidian shows a confirmation dialog — click Delete
    const confirmBtn = page.locator('.modal-button-container button:has-text("Delete")');
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Wait for delete to propagate
    await page.waitForTimeout(5_000);

    // Verify on remote
    const exists = await remote.exists(TEST_NOTE);
    expect(exists).toBe(false);
  });
});
