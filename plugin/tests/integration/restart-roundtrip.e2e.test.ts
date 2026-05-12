import { describe, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ShadowVaultBootstrap } from '../../src/shadow/ShadowVaultBootstrap';
import { ObsidianRegistry } from '../../src/shadow/ObsidianRegistry';
import { setupClientPair, TEST_PRIVATE_KEY, type TestClient } from './helpers/makeAdapter';
import { assertConfigRoundTrip } from './helpers/assertConfigRoundTrip';
import { expectFailingWithShape } from './helpers/expectFailingWithShape';
import type { SshProfile } from '../../src/types';

/**
 * Layer 2 of the sync-test framework — **restart round-trip** for
 * shared Obsidian config files.
 *
 * Each case follows the same pattern:
 *
 *   1. Seed `<vaultRoot>/.obsidian/<basename>` on the remote with a
 *      known JSON payload.
 *   2. Run `ShadowVaultBootstrap` against a fresh local tmp dir.
 *   3. Assert: local `<configDir>/<basename>` matches what was on
 *      the remote.
 *
 * Issue #342 is the failure mode this captures: settings written
 * during one Obsidian session land on the remote (via the patched
 * adapter) but don't appear on the local shadow vault on the next
 * session, because `ShadowVaultBootstrap` does not pull from remote.
 * Obsidian then reads the *stale* local file on its 2nd-window
 * startup and the settings appear to have "evaporated".
 *
 * The cases below are `it.fails(...)` because the contract isn't
 * satisfied today. Removing `.fails` is part of whatever PR adds
 * the pull step to bootstrap.
 *
 * Allowlist coverage:
 *
 *   - `app.json`           — the actual #342 reproducer
 *   - `appearance.json`    — theme + UI font/size
 *   - `core-plugins.json`  — which built-in plugins are enabled
 *   - `hotkeys.json`       — keybinding overrides
 *
 * Each file is `PathMapper.isPrivate(...)` = **false** today, i.e.
 * it's intentionally shared across machines; the gap is that the
 * sharing is only one-way (push, no pull).
 *
 * Runs only when the test keypair is staged (`npm run sshd:start`).
 */

if (!fs.existsSync(TEST_PRIVATE_KEY)) {
  throw new Error(
    `Integration test keypair missing at ${TEST_PRIVATE_KEY}. ` +
    'Run `npm run sshd:start` from the repo root before `npm run test:integration`.',
  );
}

describe('Layer 2 — shared Obsidian config round-trip across plugin restart', () => {
  let pair: Awaited<ReturnType<typeof setupClientPair>>;
  let remoteClient: TestClient;

  // The bootstrap touches several paths:
  //   - `baseDir` — where shadow vaults live. Per-test tmpdir.
  //   - `sourcePluginDir` — the running plugin's directory. The
  //     bootstrap symlinks/copies this into the shadow. For the test
  //     we point it at a tiny synthetic plugin tree so install
  //     succeeds without dragging in the real plugin source.
  //   - ObsidianRegistry config path — where the obsidian.json
  //     registry file lives. Per-test tmpdir.
  let baseDir: string;
  let sourcePluginDir: string;
  let registryConfigPath: string;
  let bootstrap: ShadowVaultBootstrap;

  beforeAll(async () => {
    pair = await setupClientPair({ testLabel: 'restart-roundtrip' });
    remoteClient = pair.a;

    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-roundtrip-base-'));
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-roundtrip-home-'));
    registryConfigPath = path.join(tmpHome, 'obsidian.json');
    // ObsidianRegistry.register() reads this file before writing, so
    // it must exist with at least a minimal valid shape. Production
    // Obsidian creates it on first launch; our tests stand in for
    // that.
    fs.writeFileSync(registryConfigPath, JSON.stringify({ vaults: {} }) + '\n', 'utf-8');

    // Synthetic source plugin tree: just enough files for
    // `installPlugin` to copy/symlink. The bootstrap doesn't care
    // what's inside — only that they exist.
    sourcePluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-roundtrip-source-'));
    fs.writeFileSync(path.join(sourcePluginDir, 'main.js'), '/* test stub */\n', 'utf-8');
    fs.writeFileSync(path.join(sourcePluginDir, 'manifest.json'),
      JSON.stringify({ id: 'remote-ssh', version: '0.0.0-test', name: 'Test', minAppVersion: '1.5.0' }) + '\n',
      'utf-8');
    fs.writeFileSync(path.join(sourcePluginDir, 'styles.css'), '/* test stub */\n', 'utf-8');

    bootstrap = new ShadowVaultBootstrap(
      baseDir,
      sourcePluginDir,
      new ObsidianRegistry(registryConfigPath),
    );
  });

  afterAll(async () => {
    if (pair) await pair.cleanup();
    try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(sourcePluginDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── #342 regression cases ──────────────────────────────────────────────

  it('app.json — TODAY: bootstrap does NOT pull remote app.json (#342)', async () => {
    const profile = makeBootstrapProfile(remoteClient.vaultRoot, 'rt-app');
    await expectFailingWithShape(
      () => assertConfigRoundTrip({
        label: 'app.json',
        remoteClient,
        bootstrap,
        profile,
        allProfiles: [profile],
        configBasename: 'app.json',
        remoteContent: {
          useMarkdownLinks: false,
          newLinkFormat: 'shortest',
          attachmentFolderPath: 'attachments',
        },
      }),
      /local shadow vault missing/,
      '#342 — app.json not pulled by bootstrap (the user-facing reproducer)',
    );
  });

  it('appearance.json — TODAY: bootstrap does NOT pull remote appearance.json (#342)', async () => {
    const profile = makeBootstrapProfile(remoteClient.vaultRoot, 'rt-appearance');
    await expectFailingWithShape(
      () => assertConfigRoundTrip({
        label: 'appearance.json',
        remoteClient,
        bootstrap,
        profile,
        allProfiles: [profile],
        configBasename: 'appearance.json',
        remoteContent: {
          baseFontSize: 16,
          theme: 'obsidian',
          cssTheme: 'Things',
        },
      }),
      /local shadow vault missing/,
      '#342 — appearance.json not pulled by bootstrap',
    );
  });

  it('core-plugins.json — TODAY: bootstrap does NOT pull remote core-plugins.json (#342)', async () => {
    const profile = makeBootstrapProfile(remoteClient.vaultRoot, 'rt-core-plugins');
    await expectFailingWithShape(
      () => assertConfigRoundTrip({
        label: 'core-plugins.json',
        remoteClient,
        bootstrap,
        profile,
        allProfiles: [profile],
        configBasename: 'core-plugins.json',
        remoteContent: ['file-explorer', 'search', 'graph', 'backlink'],
      }),
      /local shadow vault missing/,
      '#342 — core-plugins.json not pulled by bootstrap',
    );
  });

  it('hotkeys.json — TODAY: bootstrap does NOT pull remote hotkeys.json (#342)', async () => {
    const profile = makeBootstrapProfile(remoteClient.vaultRoot, 'rt-hotkeys');
    await expectFailingWithShape(
      () => assertConfigRoundTrip({
        label: 'hotkeys.json',
        remoteClient,
        bootstrap,
        profile,
        allProfiles: [profile],
        configBasename: 'hotkeys.json',
        remoteContent: {
          'editor:toggle-bold': [{ modifiers: ['Mod'], key: 'B' }],
        },
      }),
      /local shadow vault missing/,
      '#342 — hotkeys.json not pulled by bootstrap',
    );
  });
});

/**
 * Bootstrap-shaped SshProfile that matches the docker test sshd that
 * `setupClientPair` is using. The bootstrap doesn't actually connect
 * over SSH today (it's purely-local file ops) — but once the pull
 * step lands, this profile is what the new code will use to reach
 * the remote and read `<configDir>/<basename>`.
 *
 * Each case gets a unique `id` so the shadow-vault directory name
 * `sanitise(id)` doesn't collide across cases.
 */
function makeBootstrapProfile(vaultRoot: string, caseId: string): SshProfile {
  return {
    id: `rt-${caseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Restart roundtrip (${caseId})`,
    host: '127.0.0.1',
    port: 2222,
    username: 'tester',
    authMethod: 'privateKey',
    privateKeyPath: TEST_PRIVATE_KEY,
    remotePath: vaultRoot,
    connectTimeoutMs: 10_000,
    keepaliveIntervalMs: 0,
    keepaliveCountMax: 0,
  };
}
