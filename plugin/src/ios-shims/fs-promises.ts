/**
 * iOS stub for Node.js 'fs/promises' module.
 *
 * The only consumer is `SshConfigReader`, called from the SSH auth
 * resolver which is desktop-only (iOS uses a different auth flow).
 */
function thrower(name: string) {
  return (..._args: unknown[]) => {
    throw new Error(`fs/promises.${name}() called on iOS`);
  };
}
export const mkdir = thrower('mkdir');
export const appendFile = thrower('appendFile');
export const readFile = thrower('readFile');
export const writeFile = thrower('writeFile');
export const readdir = thrower('readdir');
export const stat = thrower('stat');
export const access = thrower('access');
export const unlink = thrower('unlink');
export const rename = thrower('rename');
export const copyFile = thrower('copyFile');
