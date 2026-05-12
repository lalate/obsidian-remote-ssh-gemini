import type { EventRef } from 'obsidian';

/**
 * Shared in-process Vault test double for integration suites.
 *
 * Extracted from `sync.e2e.test.ts` so the M9 (reader-side reflect)
 * pipeline and the new self-reflect / restart / invariant suites can
 * share the same Vault surface without duplicating subtle event-bus
 * semantics. Two callers today; if a third appears, this is the
 * canonical place to extend.
 *
 * Surface contract:
 *   - The slice of `obsidian.Vault` that `VaultModelBuilder` writes
 *     to via `fileMap` + `trigger`.
 *   - The slice of `obsidian.Vault` that `FakeFileExplorer` listens
 *     on via `on` / `offref`.
 *
 * Listener crashes are swallowed inside `trigger`: real Obsidian
 * isolates each subscriber the same way (`Events.trigger` wraps every
 * handler in try/catch), and we don't want a buggy assertion in one
 * listener to mask real failures in another.
 */

export class HarnessTFile {
  vault!: unknown;
  path!: string;
  name!: string;
  basename!: string;
  extension!: string;
  parent!: HarnessTFolder | null;
  stat!: { ctime: number; mtime: number; size: number };
  constructor(vault: unknown, path: string) { this.vault = vault; this.path = path; }
}

export class HarnessTFolder {
  vault!: unknown;
  path: string = '';
  name: string = '';
  parent: HarnessTFolder | null = null;
  children: Array<HarnessTFile | HarnessTFolder> = [];
  constructor(vault?: unknown, path?: string) {
    if (vault !== undefined) this.vault = vault;
    if (path !== undefined) this.path = path;
  }
}

interface HarnessRef { name: string; cb: (...args: unknown[]) => void }

export class HarnessVault {
  fileMap: Record<string, HarnessTFile | HarnessTFolder> = {};
  private readonly root = new HarnessTFolder(undefined, '');
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private readonly refs = new Map<symbol, HarnessRef>();

  getRoot(): HarnessTFolder { return this.root; }
  getAbstractFileByPath(p: string): HarnessTFile | HarnessTFolder | null {
    return this.fileMap[p] ?? null;
  }

  on(name: string, cb: (...args: unknown[]) => unknown): EventRef {
    const set = this.listeners.get(name) ?? new Set();
    set.add(cb as (...args: unknown[]) => void);
    this.listeners.set(name, set);
    const sym = Symbol(name);
    this.refs.set(sym, { name, cb: cb as (...args: unknown[]) => void });
    return sym as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const sym = ref as unknown as symbol;
    const r = this.refs.get(sym);
    if (!r) return;
    this.listeners.get(r.name)?.delete(r.cb);
    this.refs.delete(sym);
  }

  trigger(name: string, ...args: unknown[]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const cb of [...set]) {
      try { cb(...args); } catch { /* listener crash must not break vault */ }
    }
  }
}

/** Convert a Node Buffer to an ArrayBuffer view suitable for adapter.writeBinary. */
export function asArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
