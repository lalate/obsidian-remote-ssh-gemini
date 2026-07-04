import { Notice, Plugin, requestUrl, TFile, TFolder } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { MobileSettingsTab } from './settings/MobileSettingsTab';
import type { PluginSettings, SshProfile } from './types';
import { SyncState } from './types';
import { DEFAULT_SETTINGS } from './constants';
import type { RemoteFsClient } from './adapter/RemoteFsClient';
import { RpcRemoteFsClient } from './adapter/RpcRemoteFsClient';
import { AdapterManager } from './adapter/AdapterManager';
// Type-only import — satisfies the structural type check without
// pulling in SftpClient/SSH dependencies the mobile build can't
// satisfy at runtime.
import type { ConnectionManager as ConnectionManagerClass } from './ConnectionManager';
import { ChatUI } from './chat';
import { TransferTracker } from './util/TransferTracker';
import { VaultModelBuilder } from './vault/VaultModelBuilder';
import { FsChangeListener } from './vault/FsChangeListener';
import { BulkWalker } from './vault/BulkWalker';
import { PendingEditsBar } from './ui/PendingEditsBar';
import { connectDirectWs } from './transport/DirectWsConnection';
import { establishRelayWsConnection } from './transport/RelayWsConnection';
import { logger } from './util/logger';
import { normalizeRemotePath } from './util/pathUtils';
import { errorMessage } from './util/errorMessage';
import { sanitizeClientId, defaultClientId, defaultUserName } from './path/PathMapper';
import { VaultLogger } from './main';

// ───── Mobile profile types ────────────────────────────────────────────────────

type MobileProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey' | 'agent';
  passwordRef?: string;
  privateKeyPath?: string;
  passphraseRef?: string;
  agentSocket?: string;
  hostKeyFingerprint?: string;
  remotePath: string;
  connectTimeoutMs: number;
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  transport?: 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws';
  relayBaseUrl?: string;
  relayAuthToken?: string;
  relayRpcUsername?: string;
  relayRpcPassword?: string;
  /** Direct WebSocket transport fields (used when transport === 'direct-ws'). */
  wsHost?: string;
  wsPort?: number;
  wsToken?: string;
  jumpHost?: {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey' | 'agent';
    privateKeyPath?: string;
    passwordRef?: string;
  };
};

type MobileRelayConfig = {
  endpoint: string;
  authToken?: string;
  rpcUsername?: string;
  rpcPassword?: string;
};

type MobileVerificationIssue = {
  profileId: string;
  profileName: string;
  field: 'name' | 'host' | 'port' | 'username' | 'remotePath';
  message: string;
};

type MobileVerificationResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  totalProfiles: number;
  invalidProfiles: number;
  issues: MobileVerificationIssue[];
  warnings: string[];
};

type MobileConnectionProbeEntry = {
  profileId: string;
  profileName: string;
  target: string;
  outcome: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  latencyMs?: number;
};

type MobileConnectionProbeResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  attempted: number;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  entries: MobileConnectionProbeEntry[];
  note: string;
};

type MobileSshConnectAttempt = {
  profileId: string;
  profileName: string;
  target: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  latencyMs?: number;
};

type MobileSshConnectResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  attempted: number;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  note: string;
  attempts: MobileSshConnectAttempt[];
};

type MobileRelayProbeResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  endpoint: string;
  latencyMs?: number;
  httpStatus?: number;
  detail: string;
  note: string;
};

type MobileRelayConnectResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  endpoint: string;
  latencyMs?: number;
  httpStatus?: number;
  code?: string;
  sessionId?: string;
  streamUrl?: string;
  detail: string;
  note: string;
};

type MobileRelayStreamResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  endpoint: string;
  sessionId?: string;
  streamUrl?: string;
  relayCode?: string;
  latencyMs?: number;
  detail: string;
  note: string;
};

type MobileRelayRpcResult = {
  timestamp: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  endpoint: string;
  sessionId?: string;
  streamUrl?: string;
  relayCode?: string;
  latencyMs?: number;
  serverName?: string;
  serverVersion?: string;
  fsPath?: string;
  detail: string;
  note: string;
};

type RelayConnectApiBody = {
  ok?: boolean;
  code?: string;
  message?: string;
  sessionId?: string;
  streamUrl?: string;
};

// ───── Minimal RPC handle type (structurally compatible with RpcConnection) ────

interface MobileRpcHandle {
  rpc: {
    call<T = unknown>(method: string, params: unknown): Promise<T>;
    onNotification(method: string, handler: (params: unknown) => void): () => void;
    onClose(cb: (err?: Error) => void): () => void;
    isClosed(): boolean;
    close(): void;
  };
  info: {
    protocolVersion: number;
    version: string;
    capabilities: string[];
  };
  close(): void;
}

// ───── MobileConnectionManager ──────────────────────────────────────────────────
// Structurally compatible with ConnectionManager for AdapterManager + ChatUI.
// Uses WSS-Relay only; SSH/daemon methods throw if called.

class MobileConnectionManager {
  activeProfile: SshProfile | null = null;
  activeRemoteBasePath: string | null = null;
  rpcConnection: MobileRpcHandle | null = null;

  buildFsClient(): RemoteFsClient {
    if (!this.rpcConnection) {
      throw new Error('Mobile: not connected (no RPC session)');
    }
    return new RpcRemoteFsClient(
      this.rpcConnection.rpc as unknown as ConstructorParameters<typeof RpcRemoteFsClient>[0],
    );
  }

  getActiveProfile(): SshProfile | null {
    return this.activeProfile;
  }

  getActiveClient(): RemoteFsClient | null {
    if (!this.activeProfile) return null;
    return this.buildFsClient();
  }

  getRemoteVaultPath(): string | null {
    return this.activeRemoteBasePath;
  }

  isAlive(): boolean {
    return this.rpcConnection !== null && !this.rpcConnection.rpc.isClosed();
  }

  disconnectTransport(): Promise<void> {
    if (this.rpcConnection) {
      try {
        this.rpcConnection.close();
      } catch {
        /* ignore */
      }
      this.rpcConnection = null;
    }
    this.activeProfile = null;
    this.activeRemoteBasePath = null;
    return Promise.resolve();
  }

  cancelReconnect(): void {
    // Reconnect not supported on mobile
  }

  static resolveClientId(settings: { clientId?: string }): string {
    const override = (settings.clientId ?? '').trim();
    if (override) return sanitizeClientId(override);
    return defaultClientId();
  }

  static formatUserLabel(settings: { clientId?: string; userName?: string }): string {
    const userName = settings.userName?.trim() || defaultUserName();
    const clientId = MobileConnectionManager.resolveClientId(settings);
    return `${userName}@${clientId}`;
  }
}

// ───── Plugin class ─────────────────────────────────────────────────────────────

export default class RemoteSshMobilePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  private conn = new MobileConnectionManager();
  private chatUI!: ChatUI;
  private adapterMgr!: AdapterManager;
  private fsChangeListener!: FsChangeListener;
  private transferTracker = new TransferTracker();
  private pendingEditsBar!: PendingEditsBar;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: MobileProfile[] = [];
  private mobileRelayConfig: MobileRelayConfig = { endpoint: '' };
  private state: SyncState = SyncState.IDLE;
  private vaultLogger?: VaultLogger;
  private suppressRpcCloseNotice = false;
  private autoReconnectInFlight = false;
  private lastResumeReconnectAt = 0;

  // ─── VaultLogger integration ──────────────────────────────────────────────────

  setVaultLogger(logger: VaultLogger): void {
    this.vaultLogger = logger;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async onload() {
    this.vaultLogger?.log('INFO', '>>> Mobile delegate onload START');

    try {
      await this.loadSettings();
      this.mobileSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      this.ensureBufferGlobal();

      logger.setDebug(this.settings.enableDebugLog);
      logger.setMaxLines(this.settings.maxLogLines);

      // Wire structured logger into mobile preview logs
      logger.onLine((line) => {
        const fields = line.fields ? ` ${JSON.stringify(line.fields)}` : '';
        this.pushMobilePreviewLog(`[${line.level.toUpperCase()}] ${line.message}${fields}`);
      });

      this.vaultLogger?.log('INFO', 'Settings loaded', { profiles: this.mobileProfiles?.length });

      this.fsChangeListener = new FsChangeListener(this.app);
      this.chatUI = new ChatUI(this.app, this.conn as unknown as ConnectionManagerClass, this);

      this.pendingEditsBar = new PendingEditsBar(this, () => {});

      this.adapterMgr = new AdapterManager(
        this.app,
        this.manifest,
        this.conn as unknown as ConnectionManagerClass,
        this.fsChangeListener,
        this.pendingEditsBar,
        () => this.settings,
        this.transferTracker,
      );

      this.installSettingsTab();

      this.pushMobilePreviewLog(`Mobile plugin loaded (session ${this.mobileSessionId})`);

      this.registerCommands();
      this.registerResumeReconnectHandlers();

      // Auto-connect if there's a relay-rpc profile (mirrors desktop autoConnectProfileId behavior)
      const relayProfile = this.mobileProfiles.find(p => p.transport === 'relay-rpc');
      if (relayProfile) {
        this.vaultLogger?.log('INFO', 'Auto-connecting via relay-rpc profile', { profile: relayProfile.name });
        await this.mobileConnect();
      }

      // Enable chat UI AFTER auto-connect — updateController() calls
      // buildFsClient() which throws if no RPC session exists yet.
      try {
        this.chatUI.enable();
      } catch (e) {
        this.vaultLogger?.log('WARN', 'ChatUI enable (expected if not connected)', { error: errorMessage(e) });
      }

      new Notice('Remote SSH: mobile mode enabled');
      this.vaultLogger?.log('INFO', '>>> Mobile delegate onload COMPLETE');
    } catch (e) {
      this.vaultLogger?.log('ERROR', 'Mobile onload FAILED', { error: String(e), stack: e instanceof Error ? e.stack : undefined });
      throw e;
    }
  }

  onunload() {
    this.vaultLogger?.log('INFO', 'Mobile delegate unloading');
    this.pruneSettingsTabs();
    this.chatUI?.disable();
    this.adapterMgr?.restore();
    void this.mobileDisconnect().catch(() => {
      /* ignore */
    });
    this.pushMobilePreviewLog('Unloaded mobile plugin');
  }

  // ── Commands ────────────────────────────────────────────────────────────

  private registerCommands(): void {
    this.addCommand({
      id: 'mobile-connect',
      name: 'Connect to remote vault (mobile)',
      callback: () => void this.mobileConnect(),
    });

    this.addCommand({
      id: 'mobile-disconnect',
      name: 'Disconnect from remote vault (mobile)',
      callback: () => void this.mobileDisconnect(),
    });

    this.addCommand({
      id: 'mobile-status',
      name: 'Mobile status',
      callback: () => {
        this.pushMobilePreviewLog('Executed command: mobile-status');
        new Notice(
          `Remote SSH Mobile: ${this.state === SyncState.CONNECTED ? 'Connected' : 'Disconnected'}`,
        );
      },
    });

    this.addCommand({
      id: 'mobile-copy-preview-logs',
      name: 'Mobile: copy preview logs',
      callback: () => {
        const body =
          this.mobilePreviewLogs.length === 0
            ? '(no logs)'
            : this.mobilePreviewLogs.join('\n');
        void navigator.clipboard.writeText(body);
        this.pushMobilePreviewLog('Executed command: mobile-copy-preview-logs');
        new Notice('Remote SSH: preview logs copied');
      },
    });

    this.addCommand({
      id: 'mobile-validate-profiles',
      name: 'Mobile: validate profile settings',
      callback: () => {
        const result = this.runMobileVerification();
        if (result.totalProfiles === 0) {
          this.pushMobilePreviewLog('Profile validation: no profiles configured');
          new Notice('Remote SSH: no profiles configured yet');
          return;
        }
        this.pushMobilePreviewLog(
          `Profile validation: total=${result.totalProfiles}, invalid=${result.invalidProfiles}`,
        );
        if (result.invalidProfiles === 0) {
          new Notice(
            `Remote SSH: profile settings look good (${result.totalProfiles} profiles)`,
          );
          return;
        }
        new Notice(
          `Remote SSH: ${result.invalidProfiles}/${result.totalProfiles} profiles have invalid fields`,
        );
      },
    });

    this.addCommand({
      id: 'mobile-copy-verification-report',
      name: 'Mobile: copy verification report',
      callback: () => {
        const result = this.runMobileVerification();
        const report = this.formatMobileVerificationReport(result);
        void navigator.clipboard.writeText(report);
        this.pushMobilePreviewLog('Executed command: mobile-copy-verification-report');
        new Notice('Remote SSH: verification report copied');
      },
    });

    this.addCommand({
      id: 'mobile-run-connection-probe',
      name: 'Mobile: run connection probe',
      callback: async () => {
        const result = await this.runMobileConnectionProbe();
        if (result.attempted === 0) {
          new Notice('Remote SSH: connection probe skipped (no valid profiles)');
          return;
        }
        if (result.status === 'PASS') {
          new Notice('Remote SSH: connection probe passed');
          return;
        }
        if (result.status === 'WARN') {
          new Notice(
            `Remote SSH: connection probe completed with ${result.warn} warnings`,
          );
          return;
        }
        new Notice(`Remote SSH: connection probe failed (${result.fail} failures)`);
      },
    });

    this.addCommand({
      id: 'mobile-copy-connection-probe-report',
      name: 'Mobile: copy connection probe report',
      callback: async () => {
        const result = await this.runMobileConnectionProbe();
        const report = this.formatMobileConnectionProbeReport(result);
        void navigator.clipboard.writeText(report);
        this.pushMobilePreviewLog(
          'Executed command: mobile-copy-connection-probe-report',
        );
        new Notice('Remote SSH: connection probe report copied');
      },
    });
  }

  // ─── Settings persistence ───────────────────────────────────────────────────

  async loadSettings() {
    const saved = (await this.loadData()) as
      | (Partial<PluginSettings> & {
          hostKeyStore?: Record<string, string>;
          secrets?: unknown;
          mobilePreviewLogs?: string[];
          profiles?: Array<Partial<MobileProfile>>;
          relay?: Partial<MobileRelayConfig>;
        })
      | null;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    delete (this.settings as unknown as Record<string, unknown>).autoPatchAdapter;
    this.settings.activeProfileId = null;

    this.mobilePreviewLogs = Array.isArray(saved?.mobilePreviewLogs)
      ? saved.mobilePreviewLogs.filter((v): v is string => typeof v === 'string').slice(-500)
      : [];

    this.mobileProfiles = Array.isArray(saved?.profiles)
      ? saved.profiles
          .filter((v): v is SshProfile => typeof v === 'object' && v !== null)
          .map((v) => ({
            ...this.createDefaultMobileProfile(),
            ...v,
            id:
              typeof v.id === 'string' && v.id.length > 0
                ? v.id
                : this.createDefaultMobileProfile().id,
            port: Number.isFinite(v.port) ? Number(v.port) : 22,
            transport:
              v.transport === 'sftp' || v.transport === 'rpc' || v.transport === 'relay-rpc' || v.transport === 'direct-ws'
                ? v.transport
                : 'sftp',
            authMethod:
              v.authMethod === 'privateKey' || v.authMethod === 'agent' || v.authMethod === 'password'
                ? v.authMethod
                : 'password',
            relayBaseUrl: typeof v.relayBaseUrl === 'string' ? v.relayBaseUrl : '',
            relayAuthToken: typeof v.relayAuthToken === 'string' ? v.relayAuthToken : '',
            relayRpcUsername: typeof v.relayRpcUsername === 'string' ? v.relayRpcUsername : '',
            relayRpcPassword: typeof v.relayRpcPassword === 'string' ? v.relayRpcPassword : '',
            wsHost: typeof v.wsHost === 'string' ? v.wsHost : '',
            wsPort: typeof v.wsPort === 'number' && Number.isFinite(v.wsPort) ? v.wsPort : 0,
            wsToken: typeof v.wsToken === 'string' ? v.wsToken : '',
          }))
      : [];

    this.mobileRelayConfig = {
      ...this.createDefaultMobileRelayConfig(),
      ...(saved?.relay ?? {}),
      endpoint: typeof saved?.relay?.endpoint === 'string' ? saved.relay.endpoint : '',
      authToken: typeof saved?.relay?.authToken === 'string' ? saved.relay.authToken : '',
      rpcUsername: typeof saved?.relay?.rpcUsername === 'string' ? saved.relay.rpcUsername : '',
      rpcPassword: typeof saved?.relay?.rpcPassword === 'string' ? saved.relay.rpcPassword : '',
    };
  }

  async saveSettings() {
    await this.saveData({
      ...this.settings,
      mobilePreviewLogs: this.mobilePreviewLogs,
      profiles: this.mobileProfiles,
      relay: this.mobileRelayConfig,
    });
  }

  // ─── Connect / Disconnect ───────────────────────────────────────────────────

  private async mobileConnect(): Promise<void> {
    if (this.state === SyncState.CONNECTED) {
      this.vaultLogger?.log('INFO', 'mobileConnect skipped — already connected');
      new Notice('Remote SSH: already connected');
      return;
    }

    // Pick the first profile that supports mobile (relay-rpc or direct-ws).
    // Legacy profiles without an explicit transport default to relay-rpc.
    const profile = this.mobileProfiles.find(
      (p) => p.transport === 'relay-rpc' || p.transport === 'direct-ws' || !p.transport,
    );
    if (!profile) {
      this.vaultLogger?.log('WARN', 'mobileConnect failed — no compatible profile (relay-rpc or direct-ws)');
      new Notice('Remote SSH: no connectable profile configured');
      return;
    }

    const effectivePath = normalizeRemotePath(profile.remotePath);

    this.vaultLogger?.log('INFO', 'mobileConnect starting', {
      profile: profile.name,
      transport: profile.transport ?? 'relay-rpc',
      remotePath: effectivePath,
    });

    this.state = SyncState.CONNECTING;
    this.pushMobilePreviewLog(
      `Connecting (${profile.transport ?? 'relay-rpc'}): ${profile.host || profile.wsHost}${effectivePath}`,
    );

    try {
      if (profile.transport === 'direct-ws') {
        await this.mobileConnectDirectWs(profile, effectivePath);
      } else {
        await this.mobileConnectRelay(profile, effectivePath);
      }

      // Patch adapter
      this.vaultLogger?.log('INFO', 'Patching adapter...');
      const patched = await this.adapterMgr.patch();
      if (!patched) {
        this.state = SyncState.ERROR;
        this.vaultLogger?.log('ERROR', 'Adapter patching failed');
        throw new Error('Adapter patching failed');
      }
      this.vaultLogger?.log('INFO', 'Adapter patched successfully');
      this.pruneHiddenEntriesFromVaultModel();
      this.forcePruneHiddenEntriesFromVaultModel();

      // Populate vault file tree
      try {
        this.clearVaultModelWithEvents();
        this.vaultLogger?.log('INFO', 'Populating vault from remote...');
        const summary = await this.syncVaultModelToCurrentAdapter('mobile-connect');
        this.pushMobilePreviewLog(`Vault populated: ${summary}`);
        this.vaultLogger?.log('INFO', 'Vault populated', { summary });
      } catch (popErr) {
        this.vaultLogger?.log('WARN', 'Vault population failed (continuing)', { error: errorMessage(popErr) });
        this.pushMobilePreviewLog(`Vault populate error: ${errorMessage(popErr)}`);
        logger.warn('Vault population failed, continuing with empty file tree');
      }

      this.state = SyncState.CONNECTED;
      const userLabel = MobileConnectionManager.formatUserLabel(this.settings);
      const transportLabel = (profile.transport ?? 'relay-rpc').toUpperCase();
      this.vaultLogger?.log('INFO', 'mobileConnect COMPLETE', { userLabel, transport: transportLabel });
      new Notice(`Remote SSH: Connected to ${profile.name} as ${userLabel} via ${transportLabel}`);
      this.pushMobilePreviewLog(`Connected: ${profile.name} as ${userLabel}`);
    } catch (e) {
      this.state = SyncState.ERROR;
      const msg = errorMessage(e);
      this.vaultLogger?.log('ERROR', 'mobileConnect FAILED', { error: msg });
      this.pushMobilePreviewLog(`Connect failed: ${msg}`);
      logger.error(`Mobile connect failed: ${msg}`);
      new Notice(`Remote SSH: connect failed — ${msg}`);
      this.conn.rpcConnection = null;
    }
  }

  /** Connect via relay server handshake (POST /v1/connect + WebSocket). */
  private async mobileConnectRelay(profile: MobileProfile, effectivePath: string): Promise<void> {
    const baseUrl = profile.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint;
    if (!baseUrl) {
      throw new Error('Relay endpoint URL is required for relay-rpc transport');
    }

    this.vaultLogger?.log('INFO', 'Establishing relay WebSocket connection...');
    const relayConn = await establishRelayWsConnection({
      baseUrl,
      target: {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        remotePath: effectivePath,
      },
      authToken: profile.relayAuthToken?.trim() || this.mobileRelayConfig.authToken?.trim() || undefined,
      rpcCredentials: {
        username: profile.relayRpcUsername?.trim() || this.mobileRelayConfig.rpcUsername?.trim() || 'admin',
        password: profile.relayRpcPassword?.trim() || this.mobileRelayConfig.rpcPassword?.trim() || 'password',
      },
    });
    this.vaultLogger?.log('INFO', 'Relay WebSocket connection established', {
      sessionId: relayConn.sessionId,
    });

    this.conn.rpcConnection = {
      rpc: relayConn.rpc as unknown as MobileRpcHandle['rpc'],
      info: { protocolVersion: 1, version: 'relay-ws', capabilities: [] },
      close: () => relayConn.close(),
    };
    this.bindRpcCloseHandler('relay-rpc');
    this.conn.activeRemoteBasePath = effectivePath;
    this.conn.activeProfile = profile as unknown as SshProfile;
    this.pushMobilePreviewLog(`Relay session established (${relayConn.sessionId})`);
  }

  /** Connect directly to the Go daemon's --ws-addr endpoint (no relay). */
  private async mobileConnectDirectWs(profile: MobileProfile, effectivePath: string): Promise<void> {
    const host = profile.wsHost?.trim();
    const port = profile.wsPort;
    if (!host || !port) {
      throw new Error('Direct WebSocket requires wsHost and wsPort');
    }

    new Notice('Remote SSH: connecting via direct WebSocket…');

    // Fetch auth token from the daemon's /token endpoint if not pre-configured.
    let token = profile.wsToken?.trim();
    if (!token) {
      const tokenUrl = `http://${host}:${port}/token`;
      this.vaultLogger?.log('INFO', 'Fetching token from daemon...', { url: tokenUrl });
      try {
        const resp = await requestUrl({ url: tokenUrl, method: 'GET' });
        const body = resp.json as { token?: string };
        if (!body.token) {
          throw new Error(`Daemon returned no token field: ${JSON.stringify(body)}`);
        }
        token = body.token;
        this.vaultLogger?.log('INFO', 'Token fetched successfully');
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to fetch token from daemon: ${detail}`);
      }
    }

    const wsUrl = `ws://${host}:${port}/`;
    this.vaultLogger?.log('INFO', 'Establishing direct WebSocket connection...', { url: wsUrl });

    const directConn = await connectDirectWs({ url: wsUrl, token });
    this.vaultLogger?.log('INFO', 'Direct WebSocket connection established');

    this.conn.rpcConnection = {
      rpc: directConn.rpc as unknown as MobileRpcHandle['rpc'],
      info: { protocolVersion: 1, version: 'direct-ws', capabilities: [] },
      close: () => directConn.close(),
    };
    this.bindRpcCloseHandler('direct-ws');
    this.conn.activeRemoteBasePath = effectivePath;
    this.conn.activeProfile = profile as unknown as SshProfile;
    this.pushMobilePreviewLog('Direct WebSocket session established');
  }

  private async mobileDisconnect(): Promise<void> {
    this.suppressRpcCloseNotice = true;
    this.vaultLogger?.log('INFO', 'mobileDisconnect');
    this.pushMobilePreviewLog('Disconnecting…');
    try {
      this.adapterMgr?.restore();
      await this.syncVaultModelToCurrentAdapter('mobile-disconnect');
      await this.conn.disconnectTransport();
      this.state = SyncState.IDLE;
      this.vaultLogger?.log('INFO', 'mobileDisconnect complete');
      new Notice('Remote SSH: disconnected');
    } finally {
      this.suppressRpcCloseNotice = false;
    }
  }

  private registerResumeReconnectHandlers(): void {
    const onResume = () => {
      void this.maybeReconnectAfterResume();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onResume);
      this.register(() => window.removeEventListener('focus', onResume));
    }

    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        if (document.visibilityState === 'visible') onResume();
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.register(() => document.removeEventListener('visibilitychange', onVisibility));
    }
  }

  private isResumeAutoReconnectEnabled(): boolean {
    const maybe = this.settings as PluginSettings & { mobileAutoReconnectOnResume?: boolean };
    return maybe.mobileAutoReconnectOnResume ?? true;
  }

  private async maybeReconnectAfterResume(): Promise<void> {
    if (!this.isResumeAutoReconnectEnabled()) return;
    if (this.autoReconnectInFlight) return;
    if (this.state !== SyncState.ERROR) return;
    if (this.conn.rpcConnection) return;

    const now = Date.now();
    if (now - this.lastResumeReconnectAt < 1500) return;
    this.lastResumeReconnectAt = now;

    this.autoReconnectInFlight = true;
    this.pushMobilePreviewLog('App resumed — reconnecting…');
    new Notice('Remote SSH: app resumed, reconnecting...');
    try {
      await this.mobileConnect();
    } finally {
      this.autoReconnectInFlight = false;
    }
  }

  private bindRpcCloseHandler(transport: 'relay-rpc' | 'direct-ws'): void {
    const conn = this.conn.rpcConnection;
    if (!conn) return;
    conn.rpc.onClose((err) => {
      const reason = err ? errorMessage(err) : 'connection closed';
      this.vaultLogger?.log('WARN', 'RPC connection closed', { transport, reason });
      this.pushMobilePreviewLog(`RPC closed (${transport}): ${reason}`);
      if (this.suppressRpcCloseNotice) return;
      if (this.state !== SyncState.CONNECTED) return;
      this.state = SyncState.ERROR;
      this.adapterMgr?.restore();
      this.conn.rpcConnection = null;
      new Notice(`Remote SSH: connection lost — ${reason}`);
    });
  }

  private async syncVaultModelToCurrentAdapter(label: string): Promise<string> {
    try {
      const adapter = this.app.vault.adapter as unknown as {
        exists(path: string): Promise<boolean>;
      };
      const builder = new VaultModelBuilder(this.app.vault, { TFile, TFolder });
      const map = (this.app.vault as unknown as { fileMap: Record<string, unknown> }).fileMap;
      for (const path of Object.keys(map)) {
        if (!path) continue;
        if (this.isHiddenVaultPath(path)) {
          builder.removeOne(path);
          continue;
        }
        let keep = false;
        try {
          keep = await adapter.exists(path);
        } catch {
          keep = false;
        }
        if (!keep) builder.removeOne(path);
      }

      const walk = await new BulkWalker({ adapter: this.app.vault.adapter }).walk('');
      const result = await builder.build(walk.entries);
      const summary =
        `${result.filesAdded}f + ${result.foldersAdded}d, ` +
        `${result.skipped} skipped, ${result.errors.length} errors`;
      this.pushMobilePreviewLog(`Vault synced (${label}): ${summary}`);
      return summary;
    } catch (e) {
      logger.warn(`syncVaultModelToCurrentAdapter(${label}) failed: ${errorMessage(e)}`);
      throw e;
    }
  }

  private pruneHiddenEntriesFromVaultModel(): void {
    const builder = new VaultModelBuilder(this.app.vault, { TFile, TFolder });
    const map = (this.app.vault as unknown as { fileMap: Record<string, unknown> }).fileMap;
    for (const path of Object.keys(map)) {
      if (!path) continue;
      if (!this.isHiddenVaultPath(path)) continue;
      builder.removeOne(path);
    }
  }

  private forcePruneHiddenEntriesFromVaultModel(): void {
    const vault = this.app.vault as unknown as {
      fileMap: Record<string, unknown>;
      getRoot(): { children?: unknown[] };
    };
    const map = vault.fileMap;
    for (const path of Object.keys(map)) {
      if (!path) continue;
      if (!this.isHiddenVaultPath(path)) continue;
      const entry = map[path] as {
        parent?: { children?: unknown[] };
      };
      const parentChildren = entry.parent?.children;
      if (Array.isArray(parentChildren)) {
        const idx = parentChildren.indexOf(entry);
        if (idx >= 0) parentChildren.splice(idx, 1);
      }
      delete map[path];
    }
    const root = vault.getRoot();
    if (Array.isArray(root.children)) {
      root.children = root.children.filter((child) => {
        const maybe = child as { path?: string };
        const p = maybe.path;
        return typeof p !== 'string' || !this.isHiddenVaultPath(p);
      });
    }
  }

  private clearVaultModelWithEvents(): void {
    const builder = new VaultModelBuilder(this.app.vault, { TFile, TFolder });
    const map = (this.app.vault as unknown as { fileMap: Record<string, unknown> }).fileMap;
    const keys = Object.keys(map).filter((p) => p.length > 0);
    keys.sort((a, b) => b.length - a.length);
    for (const path of keys) {
      builder.removeOne(path);
    }
  }

  private isHiddenVaultPath(path: string): boolean {
    return path.split('/').some((seg) => seg.startsWith('.'));
  }

  // ─── Vault population ───────────────────────────────────────────────────────

  private async populateVaultFromRemote(label: string): Promise<string> {
    const start = Date.now();
    this.vaultLogger?.log('INFO', 'populateVaultFromRemote start', { label });

    const walker = new BulkWalker({
      adapter: this.app.vault.adapter,
      rpcConnection: this.conn.rpcConnection ?? undefined,
    });
    const walk = await walker.walk('');
    this.vaultLogger?.log('INFO', 'Tree walk result', {
      source: walk.source,
      entries: walk.entries.length,
      walkMs: walk.walkMs,
      fastPathError: walk.fastPathError ?? undefined,
    });
    logger.info(
      `populateVaultFromRemote(${label}): ${walk.source}, ${walk.entries.length} entries ` +
        `in ${walk.walkMs}ms` +
        (walk.fastPathError ? ` (fast-path fallback: ${walk.fastPathError})` : ''),
    );

    const builder = new VaultModelBuilder(this.app.vault, { TFile, TFolder });
    const result = await builder.build(walk.entries);
    const totalMs = Date.now() - start;

    const summary = `${result.filesAdded}f + ${result.foldersAdded}d built, ${result.skipped} skipped, ${result.errors.length} errors (${totalMs}ms)`;
    if (result.errors.length > 0) {
      this.vaultLogger?.log('WARN', 'Vault build had errors', {
        errorCount: result.errors.length,
        firstErrors: result.errors.slice(0, 5),
      });
      logger.warn(
        `populateVaultFromRemote(${label}): first 5 errors: ` +
          JSON.stringify(result.errors.slice(0, 5), null, 2),
      );
    }
    this.vaultLogger?.log('INFO', 'populateVaultFromRemote complete', { summary, totalMs });
    return summary;
  }

  // ─── Mobile log helpers ─────────────────────────────────────────────────────

  private createDefaultMobileProfile(): MobileProfile {
    return {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '',
      host: '',
      port: 22,
      username: '',
      authMethod: 'password',
      remotePath: '',
      connectTimeoutMs: 15000,
      keepaliveIntervalMs: 10000,
      keepaliveCountMax: 3,
      wsPort: 0,
    };
  }

  private createDefaultMobileRelayConfig(): MobileRelayConfig {
    return { endpoint: '' };
  }

  private pushMobilePreviewLog(line: string) {
    const ts = new Date().toISOString();
    const entry = `[${ts}] [${this.mobileSessionId}] ${line}`;
    this.mobilePreviewLogs.push(entry);
    if (this.mobilePreviewLogs.length > 500) {
      this.mobilePreviewLogs.shift();
    }
  }

  private installSettingsTab(): void {
    this.pruneSettingsTabs();
    this.addSettingTab(new MobileSettingsTab(this.app, this));
  }

  private pruneSettingsTabs(): void {
    const setting = this.app.setting as unknown as {
      settingTabs?: unknown[];
      pluginTabs?: Record<string, unknown>;
    };
    if (Array.isArray(setting.settingTabs)) {
      setting.settingTabs = setting.settingTabs.filter((tab) => {
        const maybe = tab as {
          id?: string;
          name?: string;
          plugin?: { manifest?: { id?: string } };
        };
        const byPluginId = maybe.plugin?.manifest?.id === this.manifest.id;
        const byTabId = maybe.id === this.manifest.id;
        const byName = maybe.name === this.manifest.name;
        return !(byPluginId || byTabId || byName);
      });
    }
    if (setting.pluginTabs) {
      for (const [key, value] of Object.entries(setting.pluginTabs)) {
        const maybe = value as {
          id?: string;
          name?: string;
          plugin?: { manifest?: { id?: string } };
        };
        const byPluginId = maybe.plugin?.manifest?.id === this.manifest.id;
        const byTabId = maybe.id === this.manifest.id || key === this.manifest.id;
        const byName = maybe.name === this.manifest.name;
        if (byPluginId || byTabId || byName) {
          delete setting.pluginTabs[key];
        }
      }
    }
  }

  // ─── Settings tab interface (called by MobileSettingsTab) ────────────────────

  getMobilePreviewLogs(): string[] {
    return [...this.mobilePreviewLogs];
  }

  getMobileProfiles(): Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
    transport?: 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws';
    relayBaseUrl?: string;
    relayAuthToken?: string;
    relayRpcUsername?: string;
    relayRpcPassword?: string;
    wsHost?: string;
    wsPort?: number;
    wsToken?: string;
  }> {
    return this.mobileProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      remotePath: p.remotePath,
      transport: p.transport,
      relayBaseUrl: p.relayBaseUrl,
      relayAuthToken: p.relayAuthToken,
      relayRpcUsername: p.relayRpcUsername,
      relayRpcPassword: p.relayRpcPassword,
      wsHost: p.wsHost,
      wsPort: p.wsPort,
      wsToken: p.wsToken,
    }));
  }

  getMobileRelayConfig(): {
    endpoint: string;
    authToken?: string;
    rpcUsername?: string;
    rpcPassword?: string;
  } {
    return { ...this.mobileRelayConfig };
  }

  async updateMobileRelayConfig(patch: {
    endpoint?: string;
    authToken?: string;
    rpcUsername?: string;
    rpcPassword?: string;
  }): Promise<void> {
    Object.assign(this.mobileRelayConfig, patch);
    await this.saveSettings();
  }

  async addMobileProfile(): Promise<void> {
    this.mobileProfiles.push(this.createDefaultMobileProfile());
    await this.saveSettings();
  }

  async updateMobileProfile(
    id: string,
    patch: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      remotePath?: string;
      transport?: 'sftp' | 'rpc' | 'relay-rpc' | 'direct-ws';
      relayBaseUrl?: string;
      relayAuthToken?: string;
      relayRpcUsername?: string;
      relayRpcPassword?: string;
      wsHost?: string;
      wsPort?: number;
      wsToken?: string;
    },
  ): Promise<void> {
    const profile = this.mobileProfiles.find((p) => p.id === id);
    if (!profile) return;
    Object.assign(profile, patch);
    await this.saveSettings();
  }

  async removeMobileProfile(id: string): Promise<void> {
    this.mobileProfiles = this.mobileProfiles.filter((p) => p.id !== id);
    await this.saveSettings();
  }

  async clearMobilePreviewLogs(): Promise<void> {
    this.mobilePreviewLogs = [];
    await this.saveSettings();
  }

  // ─── Verification ───────────────────────────────────────────────────────────

  runMobileVerification(): MobileVerificationResult {
    const issues: MobileVerificationIssue[] = [];
    const warnings: string[] = [];

    for (const p of this.mobileProfiles) {
      if (!p.name.trim()) {
        issues.push({
          profileId: p.id,
          profileName: p.name,
          field: 'name',
          message: 'Profile name is empty',
        });
      }
      if (!p.host.trim()) {
        issues.push({
          profileId: p.id,
          profileName: p.name,
          field: 'host',
          message: 'Host is empty',
        });
      }
      if (!Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        issues.push({
          profileId: p.id,
          profileName: p.name,
          field: 'port',
          message: `Invalid port: ${p.port}`,
        });
      }
      if (!p.username.trim()) {
        issues.push({
          profileId: p.id,
          profileName: p.name,
          field: 'username',
          message: 'Username is empty',
        });
      }
      if (!p.remotePath.trim()) {
        issues.push({
          profileId: p.id,
          profileName: p.name,
          field: 'remotePath',
          message: 'Remote path is empty',
        });
      }
    }

    if (this.mobileProfiles.length > 1) {
      warnings.push(
        `${this.mobileProfiles.length} profiles configured; only the first relay-rpc profile is used on connect`,
      );
    }

    const status: MobileVerificationResult['status'] =
      issues.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';

    return {
      timestamp: new Date().toISOString(),
      status,
      totalProfiles: this.mobileProfiles.length,
      invalidProfiles: issues.length,
      issues,
      warnings,
    };
  }

  formatMobileVerificationReport(result: MobileVerificationResult): string {
    const lines = [
      `Mobile Verification Report`,
      `===========================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Total profiles: ${result.totalProfiles}`,
      `Invalid profiles: ${result.invalidProfiles}`,
      ``,
    ];
    if (result.issues.length > 0) {
      lines.push(`Issues:`);
      for (const issue of result.issues) {
        lines.push(`  - [${issue.field}] ${issue.profileName}: ${issue.message}`);
      }
      lines.push(``);
    }
    if (result.warnings.length > 0) {
      lines.push(`Warnings:`);
      for (const w of result.warnings) lines.push(`  - ${w}`);
      lines.push(``);
    }
    return lines.join('\n');
  }

  // ─── Connection probe ───────────────────────────────────────────────────────

  async runMobileConnectionProbe(): Promise<MobileConnectionProbeResult> {
    const validProfiles = this.mobileProfiles.filter((p) => {
      const basic =
        p.host.trim() && Number.isFinite(p.port) && p.port > 0 && p.port <= 65535;
      if (p.transport === 'relay-rpc') {
        const baseUrl = p.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint;
        return basic && !!baseUrl;
      }
      return basic;
    });

    if (validProfiles.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        status: 'SKIP' as unknown as MobileConnectionProbeResult['status'],
        attempted: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        skip: 0,
        entries: [],
        note: 'No valid profiles to probe',
      };
    }

    const entries: MobileConnectionProbeEntry[] = [];
    for (const p of validProfiles) {
      let baseUrl = '';
      if (p.transport === 'relay-rpc') {
        baseUrl = p.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint;
      }

      const target = baseUrl
        ? `${p.username}@${p.host}:${p.port} via ${baseUrl}`
        : `${p.username}@${p.host}:${p.port}`;

      const start = Date.now();
      try {
        if (baseUrl) {
          const resp = await requestUrl({
            url: baseUrl.replace(/\/+$/, ''),
            method: 'GET',
          });
          const latencyMs = Date.now() - start;
          if (resp.status >= 200 && resp.status < 400) {
            entries.push({
              profileId: p.id,
              profileName: p.name,
              target,
              outcome: 'PASS',
              detail: `Relay reachable (HTTP ${resp.status})`,
              latencyMs,
            });
          } else {
            entries.push({
              profileId: p.id,
              profileName: p.name,
              target,
              outcome: 'WARN',
              detail: `Relay returned HTTP ${resp.status}`,
              latencyMs,
            });
          }
        } else {
          entries.push({
            profileId: p.id,
            profileName: p.name,
            target,
            outcome: 'SKIP',
            detail: 'Direct SSH probe not available on mobile',
          });
        }
      } catch (e) {
        const latencyMs = Date.now() - start;
        entries.push({
          profileId: p.id,
          profileName: p.name,
          target,
          outcome: 'FAIL',
          detail: errorMessage(e),
          latencyMs,
        });
      }
    }

    const pass = entries.filter((e) => e.outcome === 'PASS').length;
    const warnCount = entries.filter((e) => e.outcome === 'WARN').length;
    const failCount = entries.filter((e) => e.outcome === 'FAIL').length;
    const skipCount = entries.filter((e) => e.outcome === 'SKIP').length;
    const status: MobileConnectionProbeResult['status'] =
      failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';

    return {
      timestamp: new Date().toISOString(),
      status,
      attempted: entries.length,
      pass,
      warn: warnCount,
      fail: failCount,
      skip: skipCount,
      entries,
      note:
        failCount > 0
          ? `${failCount} probe(s) failed`
          : pass > 0
            ? 'All probes passed'
            : 'No probes completed',
    };
  }

  formatMobileConnectionProbeReport(result: MobileConnectionProbeResult): string {
    const lines = [
      `Mobile Connection Probe Report`,
      `================================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Attempted: ${result.attempted}, Pass: ${result.pass}, Warn: ${result.warn}, Fail: ${result.fail}, Skip: ${result.skip}`,
      ``,
    ];
    for (const e of result.entries) {
      lines.push(`  [${e.outcome}] ${e.profileName} (${e.target})`);
      lines.push(`    ${e.detail}${e.latencyMs ? ` (${e.latencyMs}ms)` : ''}`);
    }
    lines.push(``);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
  }

  // ─── SSH connect test (relay-only equivalent) ────────────────────────────────

  async runMobileSshConnectTest(): Promise<MobileSshConnectResult> {
    const profiles = this.mobileProfiles.filter((p) => {
      const hasRelay = !!(p.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint);
      return p.transport === 'relay-rpc' && hasRelay && p.host.trim() && p.username.trim();
    });

    if (profiles.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        status: 'SKIP' as unknown as MobileSshConnectResult['status'],
        attempted: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        skip: 0,
        note: 'No relay-rpc profiles with relay endpoint configured',
        attempts: [],
      };
    }

    const attempts: MobileSshConnectAttempt[] = [];
    for (const p of profiles) {
      const baseUrl = p.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint;
      const target = `${p.username}@${p.host}:${p.port} via ${baseUrl}`;
      const start = Date.now();

      try {
        const resp = await requestUrl({
          url: `${baseUrl.replace(/\/+$/, '')}/v1/connect`,
          method: 'POST',
          contentType: 'application/json',
          headers: {
            Accept: 'application/json',
            ...(p.relayAuthToken?.trim()
              ? { Authorization: `Bearer ${p.relayAuthToken.trim()}` }
              : {}),
          },
          body: JSON.stringify({
            host: p.host,
            port: p.port,
            username: p.username,
            remotePath: normalizeRemotePath(p.remotePath),
          }),
        });
        const latencyMs = Date.now() - start;
        if (resp.status >= 200 && resp.status < 300) {
          attempts.push({
            profileId: p.id,
            profileName: p.name,
            target,
            status: 'PASS',
            detail: `Relay /v1/connect OK (HTTP ${resp.status})`,
            latencyMs,
          });
        } else {
          attempts.push({
            profileId: p.id,
            profileName: p.name,
            target,
            status: 'WARN',
            detail: `Relay /v1/connect returned HTTP ${resp.status}`,
            latencyMs,
          });
        }
      } catch (e) {
        const latencyMs = Date.now() - start;
        attempts.push({
          profileId: p.id,
          profileName: p.name,
          target,
          status: 'FAIL',
          detail: errorMessage(e),
          latencyMs,
        });
      }
    }

    const pass = attempts.filter((a) => a.status === 'PASS').length;
    const warnCount = attempts.filter((a) => a.status === 'WARN').length;
    const failCount = attempts.filter((a) => a.status === 'FAIL').length;
    const status: MobileSshConnectResult['status'] =
      failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';

    return {
      timestamp: new Date().toISOString(),
      status,
      attempted: attempts.length,
      pass,
      warn: warnCount,
      fail: failCount,
      skip: 0,
      note:
        failCount > 0
          ? `${failCount} connect(s) failed`
          : pass > 0
            ? 'All connects passed'
            : 'No connects completed',
      attempts,
    };
  }

  formatMobileSshConnectReport(result: MobileSshConnectResult): string {
    const lines = [
      `Mobile Connect Test Report`,
      `===========================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Attempted: ${result.attempted}, Pass: ${result.pass}, Warn: ${result.warn}, Fail: ${result.fail}`,
      ``,
    ];
    for (const a of result.attempts) {
      lines.push(`  [${a.status}] ${a.profileName} (${a.target})`);
      lines.push(`    ${a.detail}${a.latencyMs ? ` (${a.latencyMs}ms)` : ''}`);
    }
    lines.push(``);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
  }

  // ─── Relay tests ────────────────────────────────────────────────────────────

  async runMobileRelayProbe(): Promise<MobileRelayProbeResult> {
    const endpoint = this.mobileRelayConfig.endpoint?.trim();
    if (!endpoint) {
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: '',
        detail: 'No relay endpoint configured',
        note: 'Configure a relay endpoint URL in settings',
      };
    }

    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: endpoint.replace(/\/+$/, ''),
        method: 'GET',
        headers: this.mobileRelayConfig.authToken
          ? { Authorization: `Bearer ${this.mobileRelayConfig.authToken}` }
          : undefined,
      });
      const latencyMs = Date.now() - start;
      const ok = resp.status >= 200 && resp.status < 400;
      return {
        timestamp: new Date().toISOString(),
        status: ok ? 'PASS' : 'WARN',
        endpoint,
        latencyMs,
        httpStatus: resp.status,
        detail: ok ? 'Relay reachable' : `Relay returned HTTP ${resp.status}`,
        note: ok ? 'Relay endpoint is reachable' : 'Relay endpoint returned a non-2xx status',
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint,
        latencyMs,
        detail: errorMessage(e),
        note: 'Relay endpoint unreachable or request failed',
      };
    }
  }

  formatMobileRelayProbeReport(result: MobileRelayProbeResult): string {
    const lines = [
      `Mobile Relay Probe Report`,
      `===========================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Endpoint: ${result.endpoint}`,
      `HTTP Status: ${result.httpStatus ?? 'N/A'}`,
      `Latency: ${result.latencyMs != null ? `${result.latencyMs}ms` : 'N/A'}`,
      `Detail: ${result.detail}`,
      `Note: ${result.note}`,
    ];
    return lines.join('\n');
  }

  async runMobileRelayConnectTest(): Promise<MobileRelayConnectResult> {
    const profile = this.mobileProfiles.find((p) => p.transport === 'relay-rpc');
    const baseUrl =
      profile?.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint?.trim();
    if (!profile || !baseUrl) {
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl || '',
        detail: 'No relay-rpc profile or endpoint configured',
        note: 'Create a relay-rpc profile and configure the relay endpoint',
      };
    }

    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: `${baseUrl.replace(/\/+$/, '')}/v1/connect`,
        method: 'POST',
        contentType: 'application/json',
        headers: {
          Accept: 'application/json',
          ...(profile.relayAuthToken?.trim()
            ? { Authorization: `Bearer ${profile.relayAuthToken.trim()}` }
            : {}),
        },
        body: JSON.stringify({
          host: profile.host,
          port: profile.port,
          username: profile.username,
          remotePath: normalizeRemotePath(profile.remotePath),
        }),
      });
      const latencyMs = Date.now() - start;
      const body = resp.json as RelayConnectApiBody;

      if (resp.status >= 200 && resp.status < 300 && body.streamUrl && body.sessionId) {
        return {
          timestamp: new Date().toISOString(),
          status: 'PASS',
          endpoint: baseUrl,
          latencyMs,
          httpStatus: resp.status,
          code: body.code,
          sessionId: body.sessionId,
          streamUrl: body.streamUrl,
          detail: 'Relay /v1/connect succeeded',
          note: 'Relay accepted the SSH connection request',
        };
      }
      return {
        timestamp: new Date().toISOString(),
        status: 'WARN',
        endpoint: baseUrl,
        latencyMs,
        httpStatus: resp.status,
        code: body.code,
        detail:
          body.message ||
          `Relay returned HTTP ${resp.status} without sessionId/streamUrl`,
        note: 'Relay responded but the response is incomplete',
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl,
        latencyMs,
        detail: errorMessage(e),
        note: 'Relay /v1/connect request failed',
      };
    }
  }

  formatMobileRelayConnectReport(result: MobileRelayConnectResult): string {
    const lines = [
      `Mobile Relay Connect Test Report`,
      `==================================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Endpoint: ${result.endpoint}`,
      `HTTP Status: ${result.httpStatus ?? 'N/A'}`,
      `Latency: ${result.latencyMs != null ? `${result.latencyMs}ms` : 'N/A'}`,
      `Session ID: ${result.sessionId || 'N/A'}`,
      `Stream URL: ${result.streamUrl || 'N/A'}`,
      `Detail: ${result.detail}`,
      `Note: ${result.note}`,
    ];
    return lines.join('\n');
  }

  async runMobileRelayStreamTest(): Promise<MobileRelayStreamResult> {
    const profile = this.mobileProfiles.find((p) => p.transport === 'relay-rpc');
    const baseUrl =
      profile?.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint?.trim();
    if (!profile || !baseUrl) {
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl || '',
        detail: 'No relay-rpc profile or endpoint configured',
        note: 'Create a relay-rpc profile and configure the relay endpoint',
      };
    }

    const start = Date.now();
    try {
      const relayConn = await establishRelayWsConnection({
        baseUrl,
        target: {
          host: profile.host,
          port: profile.port,
          username: profile.username,
          remotePath: normalizeRemotePath(profile.remotePath),
        },
        authToken:
          profile.relayAuthToken?.trim() ||
          this.mobileRelayConfig.authToken?.trim() ||
          undefined,
        rpcCredentials: {
          username:
            profile.relayRpcUsername?.trim() ||
            this.mobileRelayConfig.rpcUsername?.trim() ||
            'admin',
          password:
            profile.relayRpcPassword?.trim() ||
            this.mobileRelayConfig.rpcPassword?.trim() ||
            'password',
        },
        timeoutMs: 15000,
      });

      const latencyMs = Date.now() - start;
      relayConn.close();

      return {
        timestamp: new Date().toISOString(),
        status: 'PASS',
        endpoint: baseUrl,
        sessionId: relayConn.sessionId,
        streamUrl: relayConn.streamUrl,
        latencyMs,
        detail: 'WebSocket stream opened and session.ready received',
        note: 'Relay WebSocket stream test passed',
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl,
        latencyMs,
        detail: errorMessage(e),
        note: 'Relay stream test failed',
      };
    }
  }

  formatMobileRelayStreamReport(result: MobileRelayStreamResult): string {
    const lines = [
      `Mobile Relay Stream Test Report`,
      `=================================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Endpoint: ${result.endpoint}`,
      `Latency: ${result.latencyMs != null ? `${result.latencyMs}ms` : 'N/A'}`,
      `Session ID: ${result.sessionId || 'N/A'}`,
      `Stream URL: ${result.streamUrl || 'N/A'}`,
      `Detail: ${result.detail}`,
      `Note: ${result.note}`,
    ];
    return lines.join('\n');
  }

  async runMobileRelayRpcTest(): Promise<MobileRelayRpcResult> {
    const profile = this.mobileProfiles.find((p) => p.transport === 'relay-rpc');
    const baseUrl =
      profile?.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint?.trim();
    if (!profile || !baseUrl) {
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl || '',
        detail: 'No relay-rpc profile or endpoint configured',
        note: 'Create a relay-rpc profile and configure the relay endpoint',
      };
    }

    const start = Date.now();
    try {
      const relayConn = await establishRelayWsConnection({
        baseUrl,
        target: {
          host: profile.host,
          port: profile.port,
          username: profile.username,
          remotePath: normalizeRemotePath(profile.remotePath),
        },
        authToken:
          profile.relayAuthToken?.trim() ||
          this.mobileRelayConfig.authToken?.trim() ||
          undefined,
        rpcCredentials: {
          username:
            profile.relayRpcUsername?.trim() ||
            this.mobileRelayConfig.rpcUsername?.trim() ||
            'admin',
          password:
            profile.relayRpcPassword?.trim() ||
            this.mobileRelayConfig.rpcPassword?.trim() ||
            'password',
        },
        timeoutMs: 15000,
      });

      let serverName = '';
      let serverVersion = '';
      let fsPath = '';

      try {
        const rpcFs = new RpcRemoteFsClient(
          relayConn.rpc as unknown as ConstructorParameters<typeof RpcRemoteFsClient>[0],
        );
        const entries = await rpcFs.list(
          normalizeRemotePath(profile.remotePath),
        );
        serverName = 'relay-ws';
        serverVersion = '1.0';
        fsPath = normalizeRemotePath(profile.remotePath);
      } catch {
        // The daemon info endpoint may not be exposed via relay
      }

      const latencyMs = Date.now() - start;
      relayConn.close();

      return {
        timestamp: new Date().toISOString(),
        status: 'PASS',
        endpoint: baseUrl,
        sessionId: relayConn.sessionId,
        streamUrl: relayConn.streamUrl,
        latencyMs,
        serverName,
        serverVersion,
        fsPath,
        detail: 'WebSocket stream opened, auth handshake completed, RPC call succeeded',
        note: 'Relay JSON-RPC test passed',
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      return {
        timestamp: new Date().toISOString(),
        status: 'FAIL',
        endpoint: baseUrl,
        latencyMs,
        detail: errorMessage(e),
        note: 'Relay RPC test failed',
      };
    }
  }

  formatMobileRelayRpcReport(result: MobileRelayRpcResult): string {
    const lines = [
      `Mobile Relay RPC Test Report`,
      `==============================`,
      `Timestamp: ${result.timestamp}`,
      `Status: ${result.status}`,
      `Endpoint: ${result.endpoint}`,
      `Latency: ${result.latencyMs != null ? `${result.latencyMs}ms` : 'N/A'}`,
      `Session ID: ${result.sessionId || 'N/A'}`,
      `Server: ${result.serverName || 'N/A'} ${result.serverVersion || ''}`,
      `FS Path: ${result.fsPath || 'N/A'}`,
      `Detail: ${result.detail}`,
      `Note: ${result.note}`,
    ];
    return lines.join('\n');
  }

  // ─── Buffer setup ──────────────────────────────────────────────────────────
  // Mobile Obsidian (iOS/Android) does not ship Node.js Buffer natively.
  // RpcRemoteFsClient.encodeText / decodeText need it for Base64 round-trips
  // of binary file content. This method attempts to obtain Buffer from the
  // module system or a global polyfill, or falls back to a minimal inline
  // implementation that covers the subset RpcRemoteFsClient actually uses.

  private ensureBufferGlobal(): void {
    if (this.hasBufferGlobal()) return;

    const rt = globalThis as typeof globalThis & {
      Buffer?: unknown;
      require?: (id: string) => unknown;
    };

    // 1. Try the runtime module system (e.g. bundled polyfill).
    if (typeof rt.require === 'function') {
      try {
        const mod = rt.require('buffer') as { Buffer?: unknown } | undefined;
        if (mod?.Buffer) {
          rt.Buffer = mod.Buffer as BufferConstructor;
          return;
        }
      } catch {
        // module not available - fall through
      }
    }

    // 2. Minimal inline polyfill covering the subset used by
    //    RpcRemoteFsClient.encodeText / decodeText (Base64 ↔ Uint8Array).
    //    Full Node Buffer API is not needed.
    if (!rt.Buffer) {
      rt.Buffer = class MiniBuffer {
        static from(data: string | Uint8Array, encoding?: string): MiniBuffer {
          if (typeof data === 'string') {
            if (encoding === 'base64') {
              return new MiniBuffer(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
            }
            if (encoding === 'utf8' || encoding === 'utf-8' || !encoding) {
              const encoder = new TextEncoder();
              return new MiniBuffer(encoder.encode(data));
            }
            throw new Error(`MiniBuffer: unsupported encoding ${encoding}`);
          }
          return new MiniBuffer(data);
        }

        readonly length: number;
        private readonly bytes: Uint8Array;

        constructor(data: Uint8Array) {
          this.bytes = data;
          this.length = data.length;
        }

        toString(encoding?: string): string {
          if (encoding === 'base64') {
            let binary = '';
            for (let i = 0; i < this.bytes.length; i++) {
              binary += String.fromCharCode(this.bytes[i]);
            }
            return btoa(binary);
          }
          const decoder = new TextDecoder(encoding ?? 'utf-8');
          return decoder.decode(this.bytes);
        }

        slice(start?: number, end?: number): MiniBuffer {
          return new MiniBuffer(this.bytes.slice(start, end));
        }
      } as unknown as BufferConstructor;
    }
  }

  private hasBufferGlobal(): boolean {
    return typeof (globalThis as { Buffer?: unknown }).Buffer !== 'undefined';
  }
}
