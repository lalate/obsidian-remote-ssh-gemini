import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the three transport collaborators startRpcSession touches.
// `resolveRemotePath` is kept REAL (pure) so the absolute-vault-root
// computation under test is exercised for real, not stubbed.
vi.mock('../src/transport/DaemonProbe', () => ({
  tryReuseExistingDaemon: vi.fn(),
}));
vi.mock('../src/transport/RpcConnection', () => ({
  establishRpcConnection: vi.fn(),
}));
const deployMock = vi.fn();
vi.mock('../src/transport/ServerDeployer', async (orig) => {
  const actual = await orig<typeof import('../src/transport/ServerDeployer')>();
  return {
    ...actual, // keep the real resolveRemotePath
    // A class (not an arrow) — ConnectionManager does `new ServerDeployer(client)`.
    ServerDeployer: class { deploy = deployMock; },
  };
});

import { ConnectionManager } from '../src/ConnectionManager';
import { tryReuseExistingDaemon } from '../src/transport/DaemonProbe';
import { establishRpcConnection } from '../src/transport/RpcConnection';
import type { SshProfile } from '../src/types';

describe('ConnectionManager static helpers', () => {
  it('resolveClientId sanitizes explicit clientId overrides', () => {
    expect(ConnectionManager.resolveClientId({ clientId: '  laptop / dev  ' })).toBe('laptop-dev');
  });

  it('resolveClientId falls back to defaultClientId when clientId is blank or omitted', () => {
    const fromBlank = ConnectionManager.resolveClientId({ clientId: '   ' });
    const fromEmpty = ConnectionManager.resolveClientId({ clientId: '' });
    const fromOmitted = ConnectionManager.resolveClientId({});
    expect(fromBlank).toBe(fromEmpty);
    expect(fromEmpty).toBe(fromOmitted);
    expect(fromBlank).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(fromBlank).not.toMatch(/^-|-$/);
  });

  it('formatUserLabel uses trimmed userName + resolved clientId', () => {
    expect(ConnectionManager.formatUserLabel({
      userName: '  alice  ',
      clientId: 'desk 01',
    })).toBe('alice@desk-01');
  });

  it('formatUserLabel falls back when values are blank', () => {
    const label = ConnectionManager.formatUserLabel({ userName: '   ', clientId: '   ' });
    const [name, id] = label.split('@');
    expect(name).toBeTruthy();
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(id).not.toMatch(/^-|-$/);
  });
});

// ─── startRpcSession: daemon-reuse vault-root validation (#355) ───────────────
// Pins the branch the connect e2e does NOT exercise (it always
// fresh-deploys): reuse-on-match, kill+redeploy-on-mismatch, and the
// `reused.info.vaultRoot ?? ''` guard against an old daemon omitting
// the field.

describe('ConnectionManager.startRpcSession — daemon-reuse vault-root guard', () => {
  const tryReuse = vi.mocked(tryReuseExistingDaemon);
  const estRpc = vi.mocked(establishRpcConnection);

  const HOME = '/home/souta';
  const profile = { id: 'p', name: 'P', remotePath: '~/work' } as unknown as SshProfile;

  function makeClient() {
    return {
      getRemoteHome: vi.fn().mockResolvedValue(HOME),
      openUnixStream: vi.fn().mockResolvedValue({}),
    } as unknown as ConstructorParameters<typeof ConnectionManager>[0];
  }
  function makeMgr() {
    return new ConnectionManager(makeClient(), { locateDaemonBinary: () => '/local/daemon' });
  }
  function reusedConn(vaultRoot: string | undefined) {
    return {
      info: { version: '0', protocolVersion: 1, capabilities: [], vaultRoot },
      close: vi.fn(),
    };
  }

  beforeEach(() => {
    tryReuse.mockReset();
    estRpc.mockReset();
    deployMock.mockReset();
    deployMock.mockResolvedValue({ token: 'tok', remoteSocketPath: 'sock' });
    estRpc.mockResolvedValue({
      info: { version: '0', protocolVersion: 1, capabilities: [], vaultRoot: `${HOME}/work` },
      close: vi.fn(),
    } as never);
  });

  it('reuses the daemon when its vaultRoot matches the profile root (no redeploy)', async () => {
    const reused = reusedConn(`${HOME}/work`); // resolveRemotePath('work', HOME) === /home/souta/work
    tryReuse.mockResolvedValue(reused as never);
    const mgr = makeMgr();

    await mgr.startRpcSession(profile, 'work');

    expect(mgr.rpcConnection).toBe(reused);
    expect(deployMock).not.toHaveBeenCalled();
    expect(reused.close).not.toHaveBeenCalled();
  });

  it('closes the stale daemon and redeploys at the correct root on mismatch', async () => {
    const reused = reusedConn(`${HOME}/work/OldVaultDev`); // different root
    tryReuse.mockResolvedValue(reused as never);
    const mgr = makeMgr();

    await mgr.startRpcSession(profile, 'work');

    expect(reused.close).toHaveBeenCalledTimes(1);
    expect(deployMock).toHaveBeenCalledTimes(1);
    // deploy() must get the ABSOLUTE resolved root, not the relative form.
    expect(deployMock.mock.calls[0][0]).toMatchObject({
      remoteVaultRoot: `${HOME}/work`,
    });
  });

  it('treats an absent vaultRoot (old/3rd-party daemon) as a mismatch — redeploys, no throw', async () => {
    const reused = reusedConn(undefined); // `?? ''` guard path
    tryReuse.mockResolvedValue(reused as never);
    const mgr = makeMgr();

    await expect(mgr.startRpcSession(profile, 'work')).resolves.toBeUndefined();
    expect(reused.close).toHaveBeenCalledTimes(1);
    expect(deployMock).toHaveBeenCalledTimes(1);
  });

  it('deploys fresh when there is no daemon to reuse', async () => {
    tryReuse.mockResolvedValue(null);
    const mgr = makeMgr();

    await mgr.startRpcSession(profile, 'work');

    expect(deployMock).toHaveBeenCalledTimes(1);
    expect(deployMock.mock.calls[0][0]).toMatchObject({ remoteVaultRoot: `${HOME}/work` });
  });
});
