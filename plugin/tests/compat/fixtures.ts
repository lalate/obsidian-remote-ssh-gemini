import * as fs from 'fs';
import * as path from 'path';
import { CompatVault } from './CompatVault';

/**
 * Load every `.md` file under `dirAbsolute` into `vault` at its
 * relative path. Used by Phase E plugin compat scenarios to seed a
 * deterministic 5-15 file fixture vault before driving the
 * plugin-equivalent calls.
 *
 * Awaits each `vault.create` so a duplicate-path or permission
 * failure surfaces as a rejection rather than being swallowed by a
 * `void` cast (PR-224 review M1). Returns the count loaded so the
 * caller can assert on it.
 */
export async function loadFixtures(vault: CompatVault, dirAbsolute: string): Promise<number> {
  let count = 0;
  for (const entry of walk(dirAbsolute)) {
    const rel = path.relative(dirAbsolute, entry).split(path.sep).join('/');
    const body = fs.readFileSync(entry, 'utf8');
    await vault.create(rel, body);
    count++;
  }
  return count;
}

function* walk(dir: string): IterableIterator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile() && p.endsWith('.md')) {
      yield p;
    }
  }
}

/** Resolves to `plugin/tests/compat/fixtures/`. */
export function fixturesDir(): string {
  return path.join(__dirname, 'fixtures');
}
