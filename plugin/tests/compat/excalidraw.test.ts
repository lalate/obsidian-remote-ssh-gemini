import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import type { TAbstractFile, TFile } from 'obsidian';
import { CompatVault } from './CompatVault';
import { fixturesDir, loadFixtures } from './fixtures';

/**
 * Phase E F13 — Excalidraw / canvas binary attachment compat.
 *
 * Excalidraw stores drawings as `.excalidraw.md` text (the JSON
 * payload wrapped in a markdown codeblock so Obsidian's regular
 * text editor can still open them) plus optional embedded image
 * binaries written via `vault.createBinary` and read back via
 * `vault.readBinary`. The issue (#124 F13) calls out byte-equality
 * on the binary path as the load-bearing assertion.
 *
 * Hot APIs exercised:
 *   - vault.read(file)            — load .excalidraw.md text
 *   - vault.modify(file, content) — save drawing edits
 *   - vault.createBinary(p, buf)  — write attachments
 *   - vault.readBinary(file)      — round-trip attachments
 *   - vault.delete(file)          — remove an attachment
 *
 * Real Excalidraw also calls `getResourcePath(file)` to render the
 * binary in <img>; that's served by the ResourceBridge in production
 * and is out of harness scope (the harness has no HTTP server).
 */

function asFile(f: TAbstractFile | null): TFile {
  if (!f) throw new Error('asFile: expected a file, got null');
  return f as unknown as TFile;
}

/** Cycle bytes 0..255 across `length` so the round-trip can spot-check any byte. */
function cyclicBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i & 0xff;
  return out;
}

/**
 * Deterministic pseudo-random byte sequence (xorshift32) for
 * big-payload tests. xorshift breaks if the state ever becomes 0,
 * so we replace a 0 seed with a non-zero default. (The `| 0` int32
 * coercion is just to keep state as a 32-bit signed int across the
 * shift operations — it doesn't filter anything out.)
 */
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = (seed | 0) === 0 ? 0x12345678 : (seed | 0);
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

/** Wrap a Uint8Array view as a fresh ArrayBuffer (the vault APIs take ArrayBuffer). */
function asArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

describe('Phase E F13 — Excalidraw binary attachment compat', () => {
  let vault: CompatVault;

  beforeEach(async () => {
    vault = new CompatVault();
    const loaded = await loadFixtures(vault, path.join(fixturesDir(), 'excalidraw'));
    expect(loaded).toBe(1);
  });

  describe('drawing text round-trip', () => {
    it('reads the .excalidraw.md fixture as JSON-in-markdown', async () => {
      const file = asFile(vault.getAbstractFileByPath('sample.excalidraw.md'));
      const body = await vault.read(file);
      expect(body).toContain('"type": "excalidraw"');
      expect(body).toContain('"id": "box1"');
      // metadataCache should expose the YAML frontmatter Excalidraw uses
      // to identify a parsed drawing.
      const fm = vault.metadataCache.getFileCache(file)!.frontmatter as Record<string, unknown>;
      expect(fm['excalidraw-plugin']).toBe('parsed');
    });

    it('round-trips a save via vault.modify', async () => {
      const file = asFile(vault.getAbstractFileByPath('sample.excalidraw.md'));
      const updated = '---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Drawing\n```json\n{"type":"excalidraw","version":3,"elements":[]}\n```';

      const events: string[] = [];
      vault.on('modify', (...args) => events.push(`modify:${(args[0] as { path: string }).path}`));

      await vault.modify(file, updated);
      const body = await vault.read(file);
      expect(body).toBe(updated);
      expect(events).toEqual(['modify:sample.excalidraw.md']);
    });
  });

  describe('binary attachment round-trip', () => {
    it('writes and reads a 1 KB attachment with byte-exact equality (issue requirement)', async () => {
      const original = cyclicBytes(1024);

      const events: string[] = [];
      vault.on('create', (...args) => events.push(`create:${(args[0] as { path: string }).path}`));

      const file = await vault.createBinary('attachments/box.png', asArrayBuffer(original));
      expect(events).toEqual(['create:attachments/box.png']);

      const back = new Uint8Array(await vault.readBinary(file));
      expect(back).toEqual(original);
      expect(back.byteLength).toBe(1024);
    });

    it('preserves a PNG-shaped header + body of mixed bytes (4 KB)', async () => {
      const png = new Uint8Array(4096);
      // Real PNG magic, just to make this look like a wire-realistic blob.
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      png.set(pseudoRandomBytes(4096 - 8, 0xc0ffee), 8);

      const file = await vault.createBinary('attachments/big.png', asArrayBuffer(png));
      const back = new Uint8Array(await vault.readBinary(file));
      expect(back.byteLength).toBe(4096);
      // PNG magic preserved exactly.
      expect(back.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      // Whole-buffer equality is what matters; deep-equal on Uint8Array.
      expect(back).toEqual(png);
    });

    it('createBinary copies the input ArrayBuffer (M1) — mutating the caller buffer does not affect the store', async () => {
      // Build a Uint8Array that owns its underlying ArrayBuffer so the
      // post-call mutation actually targets the same bytes the harness
      // sees. (asArrayBuffer in this file uses `.slice()` which would
      // mask the bug — we want the raw shared-buffer case here.)
      const callerView = new Uint8Array(64);
      for (let i = 0; i < 64; i++) callerView[i] = i;

      const file = await vault.createBinary(
        'attachments/input-defensive.png',
        callerView.buffer as ArrayBuffer,
      );

      // Stomp the caller-side buffer with a distinct byte at offset 0.
      callerView[0] = 0xff;

      const back = new Uint8Array(await vault.readBinary(file));
      expect(back[0]).toBe(0); // The store kept its own copy.
    });

    it('readBinary returns a defensive copy — mutating the result does not corrupt the store', async () => {
      const original = cyclicBytes(256);
      const file = await vault.createBinary('attachments/copy.png', asArrayBuffer(original));

      const first = new Uint8Array(await vault.readBinary(file));
      // Stamp the returned buffer with a distinct byte at offset 0.
      first[0] = 0xff;

      const second = new Uint8Array(await vault.readBinary(file));
      expect(second[0]).toBe(0); // Original cycle starts at 0
      expect(second).toEqual(original);
    });

    it('createBinary rejects a duplicate path (matches CompatVault.create contract)', async () => {
      await vault.createBinary('attachments/dup.png', asArrayBuffer(cyclicBytes(16)));
      await expect(
        vault.createBinary('attachments/dup.png', asArrayBuffer(cyclicBytes(16))),
      ).rejects.toThrow(/already exists/);
    });

    it('binary attachments are NOT included in getMarkdownFiles', async () => {
      await vault.createBinary('attachments/x.png', asArrayBuffer(cyclicBytes(32)));
      const md = vault.getMarkdownFiles().map(f => f.path);
      expect(md).not.toContain('attachments/x.png');
      // The fixture stays included.
      expect(md).toContain('sample.excalidraw.md');
    });

    it('delete removes the binary and subsequent readBinary throws', async () => {
      const file = await vault.createBinary('attachments/temp.png', asArrayBuffer(cyclicBytes(8)));

      const events: string[] = [];
      vault.on('delete', (...args) => events.push(`delete:${(args[0] as { path: string }).path}`));

      await vault.delete(file);
      expect(events).toEqual(['delete:attachments/temp.png']);
      await expect(vault.readBinary(file)).rejects.toThrow(/file not found/);
    });
  });
});
