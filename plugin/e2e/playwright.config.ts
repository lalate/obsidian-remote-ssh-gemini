import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Obsidian E2E smoke tests.
 *
 * Obsidian is an Electron app — we can't use `_electron.launch()`
 * because Obsidian bundles its own Electron and its entry point
 * isn't a bare `main.js`. Instead, the test helper launches the
 * Obsidian binary directly with `--remote-debugging-port` and
 * Playwright connects via CDP (`browserType.connectOverCDP`).
 *
 * Env vars consumed by helpers:
 *   OBSIDIAN_PATH  — path to the Obsidian binary / AppImage
 *   TEST_VAULT     — path to the pre-scaffolded test vault
 *   CDP_PORT       — debugging port (default: 9222)
 *   E2E_DEMO       — set to include `demo.spec.ts` (media capture only)
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // `demo.spec.ts` is the SCREENCAST RECORDER, not a test: it asserts
  // nothing, it drives the UI purely to emit PNG frames for the README GIF.
  // `testMatch` was picking it up, so it ran inside the behavioural
  // "Obsidian E2E smoke" job — where it burns CI minutes and can only ever
  // go red for reasons unrelated to product behaviour, which is corrosive to
  // trusting the suite. Excluded by default; the `Record demo + push GIF`
  // workflow sets E2E_DEMO=1 to opt it back in.
  testIgnore: process.env.E2E_DEMO ? [] : ['**/demo.spec.ts'],
  timeout: 120_000,
  // Playwright's DEFAULT actionTimeout is 0 — wait FOREVER. With Obsidian's
  // virtualised File Explorer under Xvfb a node can be *attached but never
  // actionable* (hover popovers swallow pointer events, rows paint lazily), so
  // a bare `.click()` blocked until the whole test timed out: three minutes
  // burned with NO message, which reads as "the product hung" when in fact the
  // harness was waiting. Bound it — an unactionable element now fails with
  // Playwright's own locator diagnostic, well inside the 120 s test budget.
  actionTimeout: 30_000,
  retries: 1,
  workers: 1, // Obsidian is a single-instance app
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../e2e-results' }],
  ],
});
