import { defineConfig } from 'vitest/config';
import * as path from 'path';

// Default config runs unit tests only. Integration tests live under
// `tests/integration/` and need a running docker sshd container —
// they're routed through `vitest.integration.config.ts` and
// invoked via `npm run test:integration`.
export default defineConfig({
  resolve: {
    alias: {
      // Obsidian's npm package is types-only. UI/settings tests need
      // a runtime, so route `import 'obsidian'` to our hand-rolled mock.
      // Production builds use the real Obsidian provided by the host
      // process — this alias only applies inside vitest.
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
  test: {
    // jsdom gives us HTMLElement / document so the obsidian-mock can
    // patch DOM helpers and Modal.contentEl works for free. The
    // existing non-DOM tests stay happy under jsdom too — Buffer +
    // fs work the same as in node mode (jsdom runs on top of node).
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**', 'tests/__mocks__/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // src/ui/** and src/settings/** are now covered by the new
      // tests/ui/ + tests/settings/ suites that stand on the
      // tests/__mocks__/obsidian.ts runtime mock.
      exclude: ['src/main.ts'],
      thresholds: {
        lines: 78,
        branches: 70,
        functions: 72,
      },
    },
  },
});
