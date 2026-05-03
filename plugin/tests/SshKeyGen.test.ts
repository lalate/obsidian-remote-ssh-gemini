import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateEd25519KeyPair,
  pemPublicKeyToOpenSshEd25519,
} from '../src/ssh/SshKeyGen';

describe('SshKeyGen', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ssh-keygen-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  describe('pemPublicKeyToOpenSshEd25519', () => {
    it('round-trips a freshly-generated ed25519 PEM into OpenSSH format', () => {
      // Generate a real PEM in-test so we exercise the actual SPKI shape
      // produced by Node, not a hand-rolled fixture that could drift.
      const { publicKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const ssh = pemPublicKeyToOpenSshEd25519(publicKey, 'test@example');
      const parts = ssh.split(' ');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('ssh-ed25519');
      expect(parts[2]).toBe('test@example');

      // The base64-decoded wire format must start with a 4-byte length
      // prefix containing 11 (length of "ssh-ed25519"), then the
      // algorithm name, then a 4-byte length of 32 (raw key length).
      const wire = Buffer.from(parts[1], 'base64');
      expect(wire.readUInt32BE(0)).toBe(11);
      expect(wire.subarray(4, 4 + 11).toString('utf8')).toBe('ssh-ed25519');
      expect(wire.readUInt32BE(4 + 11)).toBe(32);
      expect(wire.length).toBe(4 + 11 + 4 + 32);
    });

    it('throws when given a non-ed25519 SPKI key', () => {
      const { publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      expect(() => pemPublicKeyToOpenSshEd25519(publicKey, 'x@y'))
        .toThrow(/unexpected SPKI ed25519 length/);
    });
  });

  describe('generateEd25519KeyPair', () => {
    it('writes private + public key files with correct content + mode', async () => {
      const keyPath = path.join(tmpDir, 'id_ed25519_test');
      const result = await generateEd25519KeyPair(keyPath, 'me@host');

      expect(fs.existsSync(keyPath)).toBe(true);
      expect(fs.existsSync(keyPath + '.pub')).toBe(true);

      // Private key: PEM-wrapped PKCS#8 ed25519
      const privBody = fs.readFileSync(keyPath, 'utf8');
      expect(privBody).toMatch(/^-----BEGIN PRIVATE KEY-----/);
      expect(privBody).toMatch(/-----END PRIVATE KEY-----\s*$/);

      // Public key file: trailing newline, matches returned string
      const pubBody = fs.readFileSync(keyPath + '.pub', 'utf8');
      expect(pubBody).toBe(result.publicKey + '\n');
      expect(pubBody.startsWith('ssh-ed25519 ')).toBe(true);
      expect(pubBody.trim().endsWith('me@host')).toBe(true);
    });

    it('creates the parent directory if missing', async () => {
      const keyPath = path.join(tmpDir, 'nested', 'subdir', 'id_test');
      await generateEd25519KeyPair(keyPath, 'me@host');
      expect(fs.existsSync(keyPath)).toBe(true);
    });

    it('different invocations produce different keys', async () => {
      const a = path.join(tmpDir, 'a');
      const b = path.join(tmpDir, 'b');
      const ra = await generateEd25519KeyPair(a, 'a@h');
      const rb = await generateEd25519KeyPair(b, 'b@h');
      // The wire-format base64 (parts[1]) must differ between distinct keys.
      const aWire = ra.publicKey.split(' ')[1];
      const bWire = rb.publicKey.split(' ')[1];
      expect(aWire).not.toBe(bWire);
    });

    // Skip the perm check on Windows — fs mode bits don't have meaningful
    // 0600 / 0644 semantics there; OpenSSH's strict-perms check also no-ops.
    const itUnix = process.platform === 'win32' ? it.skip : it;
    itUnix('writes private key with mode 0600 and public key with mode 0644', async () => {
      const keyPath = path.join(tmpDir, 'id_perm_test');
      await generateEd25519KeyPair(keyPath, 'p@h');
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(keyPath + '.pub').mode & 0o777).toBe(0o644);
    });
  });
});
