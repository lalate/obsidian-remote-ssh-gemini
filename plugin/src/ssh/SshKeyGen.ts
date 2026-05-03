import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Generate a new ed25519 SSH keypair and write it to disk in OpenSSH
 * format. Used by the F17 onboarding wizard so a first-time user
 * doesn't have to drop to a terminal for `ssh-keygen`.
 *
 * Writes two files:
 *   - `<privateKeyPath>`     — PEM-encoded private key, mode 0600
 *   - `<privateKeyPath>.pub` — `ssh-ed25519 <base64> <comment>\n`, mode 0644
 *
 * The public key string is also returned so the wizard can show it
 * with a "copy to clipboard" button — the user pastes it into the
 * remote host's `~/.ssh/authorized_keys`.
 *
 * Callers must pick `privateKeyPath` themselves (typically under
 * `~/.ssh/`); we don't auto-generate the path so the user can keep
 * keys outside of `$HOME` if they want to.
 */
export async function generateEd25519KeyPair(
  privateKeyPath: string,
  comment: string,
): Promise<{ publicKey: string }> {
  // crypto.generateKeyPair is callback-based; promisify ourselves so
  // we don't pull in `util.promisify` for a single call site.
  const { publicKey, privateKey } = await new Promise<{
    publicKey: string;
    privateKey: string;
  }>((resolve, reject) => {
    crypto.generateKeyPair(
      'ed25519',
      {
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err, pub, priv) => {
        if (err) reject(err);
        else resolve({ publicKey: pub, privateKey: priv });
      },
    );
  });

  const opensshPublic = pemPublicKeyToOpenSshEd25519(publicKey, comment);

  // Make sure the parent directory exists (caller may have picked
  // `~/.ssh/` which always exists on Unix, but Windows users with
  // OpenSSH installed via the optional feature may not have it).
  await fs.mkdir(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });

  // Private key first, with restrictive perms BEFORE the bytes land.
  // ssh2 + OpenSSH both refuse keys whose mode is wider than 0600.
  await fs.writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  await fs.writeFile(privateKeyPath + '.pub', opensshPublic + '\n', { mode: 0o644 });

  return { publicKey: opensshPublic };
}

/**
 * Convert a PEM-encoded ed25519 public key (SPKI / RFC 5958) into
 * the single-line `ssh-ed25519 <base64> <comment>` format that
 * OpenSSH's `authorized_keys` accepts.
 *
 * The SPKI structure for ed25519 is fixed-shape: a 12-byte ASN.1
 * prefix followed by the 32-byte raw public key. We slice the
 * raw key out and re-pack it in the SSH wire format:
 *
 *   uint32 length(11)
 *   bytes  "ssh-ed25519"
 *   uint32 length(32)
 *   bytes  <raw public key>
 *
 * Then base64 the whole thing. Pure data manipulation — no
 * external dependency on `sshpk` etc.
 */
export function pemPublicKeyToOpenSshEd25519(
  pemPublicKey: string,
  comment: string,
): string {
  const der = pemToDer(pemPublicKey);
  if (der.length !== 44) {
    throw new Error(
      `unexpected SPKI ed25519 length: got ${der.length}, want 44 ` +
      '(12-byte prefix + 32-byte key)',
    );
  }
  const rawKey = der.subarray(12); // 32 bytes

  const algo = Buffer.from('ssh-ed25519', 'utf8');
  const wire = Buffer.alloc(4 + algo.length + 4 + rawKey.length);
  let off = 0;
  wire.writeUInt32BE(algo.length, off); off += 4;
  algo.copy(wire, off); off += algo.length;
  wire.writeUInt32BE(rawKey.length, off); off += 4;
  rawKey.copy(wire, off);

  return `ssh-ed25519 ${wire.toString('base64')} ${comment}`;
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}
