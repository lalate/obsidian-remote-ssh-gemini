/**
 * Race a promise against a timeout. Rejects with a labelled error if
 * `ms` elapses before `promise` settles; the timer is always cleared so
 * a fast-settling promise leaves no dangling handle.
 *
 * The underlying promise is NOT cancelled on timeout — callers that need
 * teardown (e.g. closing a socket) must do it themselves, typically in a
 * `finally`. Used by the pre-spawn config pull (#429b / Phase B-3) to
 * bound how long a Connect blocks before falling back to spawning the
 * shadow window and letting it catch up.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // `window.setTimeout` returns a number in the Obsidian renderer (DOM),
  // not a NodeJS.Timeout — type it as such so @types/node's global
  // overload doesn't leak in.
  let timer: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}
