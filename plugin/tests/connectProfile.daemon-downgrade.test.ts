import { describe, it, expect, beforeEach, vi } from 'vitest';

// Importing main.ts pulls in RemoteTerminalView (extends the obsidian
// ItemView, which the unit-test obsidian mock doesn't model). Stub the leaf
// so the import graph resolves — the same shim openShadowVaultFor.test.ts uses.
vi.mock('../src/ui/RemoteTerminalView', () => ({
  RemoteTerminalView: class {},
  VIEW_TYPE_REMOTE_TERMINAL: 'remote-terminal',
}));

import { App, recordedNotices, clearNotices } from 'obsidian';
import RemoteSshPlugin from '../src/main';
import { DaemonUnavailableError } from '../src/ConnectionManager';
import { DaemonVerificationError } from '../src/transport/DaemonDownloader';
import type { SshProfile } from '../src/types';

const rpcProfile = {
  id: 'p1', name: 'Prod', host: 'h', port: 22, username: 'u',
  remotePath: '~/v', transport: 'rpc', authMethod: 'agent',
} as unknown as SshProfile;

// Build a plugin whose ConnectionManager fails the RPC startup with `err`,
// with every other connectProfile collaborator stubbed to succeed. Exercises
// the REAL connectProfile control flow; only the transport/adapter
// collaborators are mocked. Returns the disconnect spy for teardown asserts.
function makePlugin(err: Error) {
  const plugin = new RemoteSshPlugin(new App() as never) as RemoteSshPlugin;
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const conn = {
    isAlive: () => false,
    connectSsh: vi.fn().mockResolvedValue(undefined),
    startRpcSession: vi.fn().mockRejectedValue(err),
    rpcConnection: null,
    client: { disconnect },
  };
  const p = plugin as unknown as {
    settings: unknown;
    saveData: () => Promise<void>;
    conn: unknown;
    adapterMgr: unknown;
  };
  p.settings = { profiles: [rpcProfile], activeProfileId: null };
  p.saveData = vi.fn().mockResolvedValue(undefined);
  p.conn = conn;
  p.adapterMgr = { patch: vi.fn().mockResolvedValue(true), replayOfflineQueue: vi.fn().mockResolvedValue(undefined) };
  return { plugin, conn, disconnect };
}

describe('connectProfile — RPC daemon failure handling (#399 / #406)', () => {
  beforeEach(() => clearNotices());

  it('downgrades to SFTP and still reaches CONNECTED when the daemon is unavailable', async () => {
    const { plugin, conn, disconnect } = makePlugin(new DaemonUnavailableError('remote arch unsupported'));

    await plugin.connectProfile(rpcProfile);

    expect(conn.connectSsh).toHaveBeenCalledWith(rpcProfile);  // the SSH connect was really attempted
    expect(plugin.isConnected()).toBe(true);                   // connected, not errored out
    expect(disconnect).not.toHaveBeenCalled();                 // SSH session kept for SFTP
    expect(recordedNotices().some((n) => /SFTP/i.test(n))).toBe(true);
  });

  it('downgrades to SFTP (not a hard fail) when the daemon deploy/startup fails, e.g. token timeout', async () => {
    // Field regression: a daemon that deploys but never writes its token
    // used to hard-fail the connect → populate skipped → EMPTY vault. A
    // generic (non-verification) daemon-start failure must degrade to SFTP.
    const { plugin, conn, disconnect } = makePlugin(
      new Error('ServerDeployer: daemon did not write /home/u/.obsidian-remote/token within 5000ms'),
    );

    await plugin.connectProfile(rpcProfile);

    expect(conn.connectSsh).toHaveBeenCalledWith(rpcProfile);
    expect(plugin.isConnected()).toBe(true);                   // reached CONNECTED → populate runs
    expect(disconnect).not.toHaveBeenCalled();                 // SSH kept for SFTP
    expect(recordedNotices().some((n) => /SFTP/i.test(n))).toBe(true);
  });

  it('fails LOUD (no silent SFTP downgrade) when daemon verification fails', async () => {
    const { plugin, conn, disconnect } = makePlugin(new DaemonVerificationError('sha256 mismatch'));

    await plugin.connectProfile(rpcProfile);

    expect(conn.connectSsh).toHaveBeenCalledWith(rpcProfile);  // got past connect, into RPC startup
    expect(plugin.isConnected()).toBe(false);                  // ERROR, not CONNECTED
    expect(disconnect).toHaveBeenCalledTimes(1);               // connection torn down
    // "loud" = a classified error Notice surfaced AND it did NOT take the
    // silent SFTP-downgrade path (that path emits a distinct "via SFTP" notice).
    expect(recordedNotices().length).toBeGreaterThan(0);
    expect(recordedNotices().some((n) => /SFTP/i.test(n))).toBe(false);
  });
});
