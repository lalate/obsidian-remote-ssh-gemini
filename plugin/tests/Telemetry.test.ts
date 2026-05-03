import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Telemetry } from '../src/util/Telemetry';

describe('Telemetry', () => {
  let tmpDir: string;
  let logPath: string;
  let t: Telemetry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ssh-telemetry-'));
    logPath = path.join(tmpDir, 'telemetry.jsonl');
    t = new Telemetry();
  });

  afterEach(async () => {
    await t.setEnabled(false);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  describe('disabled by default', () => {
    it('isEnabled() returns false on a fresh instance', () => {
      expect(t.isEnabled()).toBe(false);
    });

    it('record* are no-ops while disabled — snapshot stays empty', () => {
      t.recordError('timeout', -32000);
      t.recordReconnect('failed');
      expect(t.snapshot()).toHaveLength(0);
    });

    it('flush() while disabled is a no-op (does not create the file)', async () => {
      await t.flush();
      expect(fs.existsSync(logPath)).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('throws when enabled=true without a logPath', async () => {
      await expect(t.setEnabled(true)).rejects.toThrow(/requires a logPath/);
    });

    it('flips isEnabled() and accepts subsequent records', async () => {
      await t.setEnabled(true, logPath);
      expect(t.isEnabled()).toBe(true);
      t.recordError('timeout', -32000);
      expect(t.snapshot()).toHaveLength(1);
    });

    it('disabling flushes any buffered counters', async () => {
      await t.setEnabled(true, logPath);
      t.recordError('auth');
      t.recordError('auth');
      await t.setEnabled(false);

      const written = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      expect(written).toHaveLength(1);
      const rec = JSON.parse(written[0]);
      expect(rec).toMatchObject({ kind: 'error', category: 'auth', count: 2 });
      expect(typeof rec.at).toBe('number');
    });

    it('repeated setEnabled(true) is idempotent (no double timer)', async () => {
      await t.setEnabled(true, logPath);
      await t.setEnabled(true, logPath);
      expect(t.isEnabled()).toBe(true);
    });
  });

  describe('counters and snapshot', () => {
    beforeEach(async () => { await t.setEnabled(true, logPath); });

    it('groups same category+code into a single counter with bumped count', () => {
      t.recordError('timeout', -32000);
      t.recordError('timeout', -32000);
      t.recordError('timeout', -32000);
      const snap = t.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]).toMatchObject({ kind: 'error', category: 'timeout', code: -32000, count: 3 });
    });

    it('keeps distinct (category, code) tuples separate', () => {
      t.recordError('timeout', -32000);
      t.recordError('timeout', -32001);
      t.recordError('auth');
      const keys = t.snapshot().map(r => `${r.kind}:${r.category}:${r.code ?? ''}`).sort();
      expect(keys).toEqual([
        'error:auth:',
        'error:timeout:-32000',
        'error:timeout:-32001',
      ]);
    });

    it('tracks reconnect kinds independently from errors', () => {
      t.recordError('timeout', -32000);
      t.recordReconnect('attempting');
      t.recordReconnect('attempting');
      t.recordReconnect('recovered');
      const snap = t.snapshot();
      expect(snap.find(r => r.kind === 'reconnect' && r.state === 'attempting')?.count).toBe(2);
      expect(snap.find(r => r.kind === 'reconnect' && r.state === 'recovered')?.count).toBe(1);
    });

    it('handles record without code (undefined → omitted)', () => {
      t.recordError('auth');
      const snap = t.snapshot();
      expect(snap[0].kind).toBe('error');
      expect(snap[0].category).toBe('auth');
      expect(snap[0].code).toBeUndefined();
    });

    it('preserves non-numeric codes as strings', () => {
      t.recordError('protocol', 'EBADRESP');
      expect(t.snapshot()[0].code).toBe('EBADRESP');
    });
  });

  describe('flush', () => {
    beforeEach(async () => { await t.setEnabled(true, logPath); });

    it('appends one JSONL line per counter and clears in-memory state', async () => {
      t.recordError('timeout', -32000);
      t.recordError('auth');
      t.recordReconnect('failed');
      await t.flush();
      expect(t.snapshot()).toHaveLength(0);

      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        const rec = JSON.parse(line);
        expect(rec).toHaveProperty('at');
        expect(rec).toHaveProperty('kind');
        expect(rec).toHaveProperty('count');
        expect(typeof rec.at).toBe('number');
      }
    });

    it('successive flushes append rather than overwrite', async () => {
      t.recordError('timeout', -32000);
      await t.flush();
      t.recordError('auth');
      await t.flush();

      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).category).toBe('timeout');
      expect(JSON.parse(lines[1]).category).toBe('auth');
    });

    it('flush with no counters is a no-op (file not created)', async () => {
      await t.flush();
      expect(fs.existsSync(logPath)).toBe(false);
    });
  });

  describe('reset', () => {
    it('drops in-memory counters without touching the file', async () => {
      await t.setEnabled(true, logPath);
      t.recordError('timeout', -32000);
      t.reset();
      expect(t.snapshot()).toHaveLength(0);
      expect(fs.existsSync(logPath)).toBe(false);
    });
  });
});
