/**
 * iOS stub for Node.js 'crypto' module.
 *
 * Provides minimal JS-only implementations for the handful of
 * crypto operations used by the SSH/RPC code.
 */

let counter = 0;

export function randomUUID(): string {
  // RFC 4122 v4-like UUID (not cryptographically secure, good enough
  // for client id generation on iOS)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (counter++ + Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function randomBytes(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (counter++ + Math.random() * 256) & 0xff;
  }
  return buf;
}

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

class Hash {
  private data = '';
  constructor(private _algorithm: string) {}
  update(data: string | Buffer): this {
    this.data += typeof data === 'string' ? data : data.toString('binary');
    return this;
  }
  digest(_encoding?: string): string | Buffer {
    // Simple non-cryptographic hash — enough for internal checksums
    let hash = 0;
    for (let i = 0; i < this.data.length; i++) {
      const char = this.data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    this.data = '';
    if (_encoding === 'hex') return hex;
    return Buffer.from(hex, 'hex');
  }
}

export function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export const webcrypto = globalThis.crypto;

export default { randomUUID, randomBytes, createHash, timingSafeEqual, webcrypto };
