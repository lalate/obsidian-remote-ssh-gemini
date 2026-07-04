/**
 * iOS stub for Node.js 'os' module.
 *
 * Provides minimal implementations so `require("os")` doesn't crash at
 * module load time.
 */

export function hostname(): string {
  return 'ios-device';
}

export function userInfo(): { username: string; homedir: string; shell: string | null } {
  return {
    username: 'mobile',
    homedir: '/',
    shell: null,
  };
}

export function homedir(): string {
  return '/';
}

export function tmpdir(): string {
  return '/tmp';
}

export function platform(): string {
  return 'darwin';
}

export function type(): string {
  return 'Darwin';
}

export function release(): string {
  return '0.0.0';
}

export function arch(): string {
  return 'arm64';
}

export function endianness(): string {
  return 'LE';
}

export function cpus(): Array<{ model: string; speed: number; times: { user: number; nice: number; sys: number; idle: number; irq: number } }> {
  return [];
}

export function totalmem(): number {
  return 0;
}

export function freemem(): number {
  return 0;
}

export const EOL = '\n';
