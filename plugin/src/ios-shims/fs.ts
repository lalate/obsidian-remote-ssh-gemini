/**
 * iOS stub for Node.js 'fs' module.
 *
 * On iOS (JavaScriptCore) the filesystem is accessed through Obsidian's
 * vault API, not Node's fs. These stubs prevent `require("fs")` from
 * crashing at module load time. Any actual fs calls will throw at runtime
 * (no iOS code path should reach them — we use VaultLogger instead of the
 * file-based Logger).
 */

class FsError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'FsError';
  }
}

class Stats {
  size: number;
  constructor() { this.size = 0; }
  isFile(): boolean { return false; }
  isDirectory(): boolean { return false; }
}

const noop = () => {};
const thrower = (name: string) => () => { throw new FsError(`fs.${name}() called on iOS`); };

export function existsSync(_path: string): boolean { return false; }
export const mkdirSync = thrower('mkdirSync');
export const statSync = thrower('statSync');
export const unlinkSync = thrower('unlinkSync');
export const renameSync = thrower('renameSync');

export const createWriteStream = thrower('createWriteStream');
export const createReadStream = thrower('createReadStream');

export const promises = {
  mkdir: thrower('promises.mkdir'),
  appendFile: thrower('promises.appendFile'),
};

export const readFileSync = thrower('readFileSync');
export const writeFileSync = thrower('writeFileSync');
export const readdirSync = thrower('readdirSync');
export const lstatSync = thrower('lstatSync');
export const realpathSync = thrower('realpathSync');
export const chmodSync = thrower('chmodSync');
export const accessSync = thrower('accessSync');
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};
export { Stats };
