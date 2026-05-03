import type {
  CachedMetadata,
  EventRef,
  FrontMatterCache,
  HeadingCache,
  ListItemCache,
  TAbstractFile,
  TFile,
  TFolder,
  Vault,
} from 'obsidian';

/**
 * Phase E compat harness — a duck-typed Vault + MetadataCache that
 * the most-installed community plugins (Dataview / Templater /
 * Excalidraw / Tasks) can drive without a real Obsidian process.
 *
 * Scope: the **hot read/write APIs** identified in the
 * `docs/plugin-compatibility.md` survey for the top-20 plugins,
 * narrowed to what plugins actually call (not the full obsidian.d.ts
 * surface). Adds-as-needed when a new plugin scenario hits an unmocked
 * method.
 *
 * Hot surface (the contract this harness honours):
 *
 *   vault.getMarkdownFiles()             → TFile[] of every '.md' file
 *   vault.getAbstractFileByPath(p)       → TFile | TFolder | null
 *   vault.read(file)                     → text contents (Promise<string>)
 *   vault.cachedRead(file)               → text contents (Promise<string>)
 *   vault.create(path, data)             → TFile (Templater)
 *   vault.modify(file, data)             → void (Templater)
 *   vault.createBinary(path, data)       → TFile (Excalidraw)
 *   vault.readBinary(file)               → ArrayBuffer (Excalidraw)
 *   metadataCache.getFileCache(file)     → CachedMetadata (Dataview, Tasks)
 *
 * Events: `on('create' | 'modify' | 'delete' | 'rename', cb)` plus
 * `offref` — same shape FakeFileExplorer already drives.
 *
 * Plugins that escape this surface (Node `fs` directly via
 * `adapter.basePath`) are out-of-scope here — they're covered by the
 * basePath patching survey (#133).
 */

// ─── lightweight TFile / TFolder shims ───────────────────────────────

export class CompatTFile implements Partial<TFile> {
  basename: string;
  extension: string;
  name: string;
  parent: TFolder | null = null;
  stat: { ctime: number; mtime: number; size: number };
  /**
   * Declared to satisfy `Partial<TFile>` shape; intentionally never
   * assigned. Plugins that touch `file.vault` directly are out of
   * harness scope — they should reach for the surrounding
   * `CompatVault` instance instead. Reading this would crash; the
   * `!` non-null assertion is "don't surface as a typing error in
   * the harness", not "promise this is initialised".
   */
  vault!: Vault;

  constructor(public path: string, public bytes: Uint8Array, mtime = Date.now()) {
    const slash = path.lastIndexOf('/');
    this.name = slash < 0 ? path : path.slice(slash + 1);
    const dot = this.name.lastIndexOf('.');
    this.basename = dot <= 0 ? this.name : this.name.slice(0, dot);
    this.extension = dot <= 0 ? '' : this.name.slice(dot + 1);
    this.stat = { ctime: mtime, mtime, size: bytes.byteLength };
  }
}

export class CompatTFolder implements Partial<TFolder> {
  name: string;
  parent: TFolder | null = null;
  children: TAbstractFile[] = [];
  /** See CompatTFile.vault — intentionally never assigned. */
  vault!: Vault;

  constructor(public path: string) {
    const slash = path.lastIndexOf('/');
    this.name = slash < 0 ? path : path.slice(slash + 1);
  }
}

// ─── parsers used by the metadata cache ──────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const TASK_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/gm;

function parseFrontmatter(body: string): { frontmatter?: FrontMatterCache; rest: string } {
  // Normalise line endings so a Windows-authored fixture (CRLF) parses
  // identically to a Unix-authored one. The fixtures in this PR are
  // LF-only but a plugin scenario added later might import a CRLF
  // file from a real vault. PR-224 review L3.
  const normalised = body.replace(/\r\n/g, '\n');
  const m = FRONTMATTER_RE.exec(normalised);
  if (!m) return { rest: normalised };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    fm[key] = parseScalar(raw);
  }
  return { frontmatter: fm as FrontMatterCache, rest: normalised.slice(m[0].length) };
}

function parseScalar(raw: string): unknown {
  if (raw === '' || raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n) && raw === String(n)) return n;
  // Strip wrapping quotes if present.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseHeadings(body: string): HeadingCache[] {
  const out: HeadingCache[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(body)) !== null) {
    out.push({
      heading: m[2].trim(),
      level: m[1].length,
      position: zeroPos(),
    } as HeadingCache);
  }
  return out;
}

function parseTasks(body: string): ListItemCache[] {
  const out: ListItemCache[] = [];
  TASK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_RE.exec(body)) !== null) {
    out.push({
      parent: -1,
      task: m[2] === ' ' ? ' ' : 'x',
      position: zeroPos(),
    } as ListItemCache);
  }
  return out;
}

function zeroPos() {
  return {
    start: { line: 0, col: 0, offset: 0 },
    end:   { line: 0, col: 0, offset: 0 },
  };
}

// ─── CompatMetadataCache ─────────────────────────────────────────────

export class CompatMetadataCache {
  private readonly cache = new Map<string, CachedMetadata>();

  /**
   * Return the memoised CachedMetadata for `file`, or null if not
   * cached. Computation happens in {@link rebuildFor} (called by
   * CompatVault on create / modify); this method is a pure read.
   */
  getFileCache(file: TFile): CachedMetadata | null {
    return this.cache.get(file.path) ?? null;
  }

  /**
   * Build the cache for the just-loaded markdown file. Called by
   * CompatVault.create / modify so the cache is always fresh.
   */
  rebuildFor(file: TFile, body: string): void {
    if (file.extension !== 'md') {
      this.cache.delete(file.path);
      return;
    }
    const { frontmatter, rest } = parseFrontmatter(body);
    const cached: CachedMetadata = {
      ...(frontmatter ? { frontmatter } : {}),
      headings: parseHeadings(rest),
      listItems: parseTasks(rest),
    };
    this.cache.set(file.path, cached);
  }

  invalidate(path: string): void {
    this.cache.delete(path);
  }
}

// ─── CompatVault ─────────────────────────────────────────────────────

interface VaultEventListener {
  name: string;
  cb: (...args: unknown[]) => void;
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

export class CompatVault {
  /** Path → file. Single source of truth. */
  private readonly files = new Map<string, CompatTFile>();
  private readonly listeners = new Map<symbol, VaultEventListener>();
  readonly metadataCache = new CompatMetadataCache();

  // ─── read APIs ──────────────────────────────────────────────────

  getMarkdownFiles(): TFile[] {
    const out: TFile[] = [];
    for (const f of this.files.values()) {
      if (f.extension === 'md') out.push(f as unknown as TFile);
    }
    return out;
  }

  getAbstractFileByPath(p: string): TAbstractFile | null {
    const f = this.files.get(p);
    return f ? (f as unknown as TAbstractFile) : null;
  }

  read(file: TFile): Promise<string> {
    const f = this.files.get(file.path);
    if (!f) throw new Error(`CompatVault.read: file not found: ${file.path}`);
    return Promise.resolve(TEXT_DECODER.decode(f.bytes));
  }

  /** Same as read; the harness has no separate cached path. */
  cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  readBinary(file: TFile): Promise<ArrayBuffer> {
    const f = this.files.get(file.path);
    if (!f) throw new Error(`CompatVault.readBinary: file not found: ${file.path}`);
    // Return a copy so callers can't mutate the stored bytes.
    const buf = new ArrayBuffer(f.bytes.byteLength);
    new Uint8Array(buf).set(f.bytes);
    return Promise.resolve(buf);
  }

  // ─── write APIs ─────────────────────────────────────────────────

  create(path: string, data: string): Promise<TFile> {
    if (this.files.has(path)) {
      throw new Error(`CompatVault.create: file already exists: ${path}`);
    }
    const file = new CompatTFile(path, TEXT_ENCODER.encode(data));
    this.files.set(path, file);
    this.metadataCache.rebuildFor(file as unknown as TFile, data);
    this.fire('create', file);
    return Promise.resolve(file as unknown as TFile);
  }

  createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    if (this.files.has(path)) {
      throw new Error(`CompatVault.createBinary: file already exists: ${path}`);
    }
    const file = new CompatTFile(path, new Uint8Array(data));
    this.files.set(path, file);
    this.metadataCache.invalidate(path);
    this.fire('create', file);
    return Promise.resolve(file as unknown as TFile);
  }

  modify(file: TFile, data: string): Promise<void> {
    const f = this.files.get(file.path);
    if (!f) throw new Error(`CompatVault.modify: file not found: ${file.path}`);
    f.bytes = TEXT_ENCODER.encode(data);
    f.stat = { ...f.stat, mtime: Date.now(), size: f.bytes.byteLength };
    this.metadataCache.rebuildFor(f as unknown as TFile, data);
    this.fire('modify', f);
    return Promise.resolve();
  }

  delete(file: TFile): Promise<void> {
    if (!this.files.delete(file.path)) {
      throw new Error(`CompatVault.delete: file not found: ${file.path}`);
    }
    this.metadataCache.invalidate(file.path);
    this.fire('delete', file);
    return Promise.resolve();
  }

  // ─── events ─────────────────────────────────────────────────────

  on(name: string, cb: (...args: unknown[]) => unknown): EventRef {
    const sym = Symbol(name);
    this.listeners.set(sym, { name, cb: cb as (...args: unknown[]) => void });
    return sym as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    this.listeners.delete(ref as unknown as symbol);
  }

  trigger(name: string, ...args: unknown[]): void {
    this.fire(name, ...args);
  }

  private fire(name: string, ...args: unknown[]): void {
    for (const { name: n, cb } of this.listeners.values()) {
      if (n !== name) continue;
      try { cb(...args); } catch { /* listener crash must not break vault */ }
    }
  }
}
