import * as net from 'node:net';

/**
 * Docker test-sshd reachability gate, shared by the connect-lifecycle /
 * connect-failure / reconnect specs.
 *
 * These specs HARD-FAIL (never skip) when sshd is down: a broken
 * connect must not pass CI green — that is precisely how 1.0.49
 * shipped broken. Keeping this in one place stops the three specs
 * from drifting apart (they previously each carried a verbatim copy).
 */

export const SSHD_HOST = '127.0.0.1';
export const SSHD_PORT = 2222;

export async function assertSshdReachable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sock = net
      .connect({ host: SSHD_HOST, port: SSHD_PORT })
      .setTimeout(5_000)
      .once('connect', () => { sock.destroy(); resolve(); })
      .once('timeout', () => { sock.destroy(); reject(new Error('timeout')); })
      .once('error', reject);
  }).catch((e) => {
    throw new Error(
      `docker test sshd not reachable at ${SSHD_HOST}:${SSHD_PORT} ` +
      `(${(e as Error).message}). Run \`npm run sshd:start\` first. ` +
      `This spec HARD-FAILS instead of skipping — a broken connect ` +
      `must not pass CI green (that is how 1.0.49 shipped broken).`,
    );
  });
}
