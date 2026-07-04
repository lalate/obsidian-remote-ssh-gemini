/**
 * iOS stub for Node.js 'http' module.
 *
 * The HTTP server is only needed for the local content bridge
 * (image/PDF rendering in shadow window), which doesn't run on iOS.
 */
export class Server {
  listen() { return this; }
  close() {}
  on() { return this; }
}
export function createServer() { return new Server(); }
export const METHODS: string[] = [];
export const STATUS_CODES: Record<number, string> = {};
export default { createServer, Server, METHODS, STATUS_CODES };
