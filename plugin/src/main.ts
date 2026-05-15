import { Notice, Platform, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

type DesktopPlugin = Plugin & {
  onload: () => Promise<void>;
  onunload: () => void;
};

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;

  async onload(): Promise<void> {
    if (Platform.isMobileApp) {
      this.addCommand({
        id: 'mobile-status',
        name: 'Mobile status (preview)',
        callback: () => {
          new Notice(
            'Remote SSH: mobile preview mode. Activation succeeded; desktop runtime is gated in this phase.',
          );
        },
      });
      new Notice('Remote SSH: mobile preview mode enabled');
      return;
    }

    const mod = await import('./main.desktop');
    const DesktopPluginClass = mod.default as new (app: App, manifest: PluginManifest) => DesktopPlugin;
    this.desktopDelegate = new DesktopPluginClass(this.app, this.manifest);
    await this.desktopDelegate.onload();
  }

  /**
   * Phase 4 entry point: connect to the profile pointed at by
   * `settings.autoConnectProfileId`, then populate the empty shadow
   * vault from the remote tree via `VaultModelBuilder`. Called once
   * on `onLayoutReady` and again from the `Reconnect` command.
   *
   * `tag` shows up in the log line so we can tell whether a given
   * run came from the layout-ready hook or a manual reconnect.
   */
  private async runAutoConnect(tag: 'layout-ready' | 'reconnect'): Promise<void> {
    const profileId = this.settings.autoConnectProfileId;
    if (!profileId) return;
    const profile = this.settings.profiles.find(p => p.id === profileId);
    if (!profile) {
      logger.warn(
        `runAutoConnect(${tag}): autoConnectProfileId=${profileId} but no matching ` +
        'profile in data.json; skipping',
      );
      new Notice(
        `Remote SSH: shadow-vault profile id ${profileId} not found in data.json — ` +
        'cannot auto-connect',
      );
      return;
    }

    if (this.conn.client.isAlive()) {
      logger.info(`runAutoConnect(${tag}): client already alive — disconnecting first`);
      try { await this.disconnect(); } catch { /* swallow; we're about to reconnect */ }
    }

    logger.info(`runAutoConnect(${tag}): connecting to profile ${profile.name}`);
    await this.connectProfile(profile);

    if (this.state !== SyncState.CONNECTED) {
      // connectProfile already surfaced a Notice on failure — don't
      // double up; just skip the populate.
      logger.warn(`runAutoConnect(${tag}): connect did not reach CONNECTED state; skipping populate`);
      return;
    }

    // Pull the shared Obsidian config (app.json / appearance.json /
    // core-plugins.json / hotkeys.json) from the remote onto the
    // local shadow disk *before* the populate, so the next time this
    // window restarts Obsidian reads fresh settings instead of the
    // stale local copy (#342). Best-effort: a failure here must not
    // block rendering the vault.
    const da = this.adapterMgr.dataAdapter;
    const hostAdapter = this.app.vault.adapter;
    if (da && hostAdapter instanceof FileSystemAdapter) {
      try {
        const cfg = await ShadowVaultBootstrap.pullSharedObsidianConfig(
          da,
          this.app.vault.configDir,
          path.join(hostAdapter.getBasePath(), this.app.vault.configDir),
        );
        if (cfg.errored.length > 0) {
          // The connection is up but some shared-config files the
          // remote *had* couldn't be pulled (transient SSH error /
          // corrupt file). Without a signal the user would just see
          // settings silently not update — the #342 symptom. Absent
          // files are not errored, so a fresh vault stays quiet.
          new Notice(
            `Remote SSH: ${cfg.errored.length} shared-config file` +
            `${cfg.errored.length === 1 ? '' : 's'} (${cfg.errored.join(', ')}) ` +
            'could not be synced — settings may be stale until the next connect',
          );
        }
      } catch (e) {
        logger.warn(
          `runAutoConnect(${tag}): shared-config pull failed: ${errorMessage(e)}`,
        );
      }
    }

    // Adapter is patched; build the file model so File Explorer
    // renders the remote tree.
    let summary: string;
    try {
      summary = await this.populateVaultFromRemote(`shadow-${tag}`);
    } catch (e) {
      const msg = errorMessage(e);
      logger.error(`runAutoConnect(${tag}): populate failed: ${msg}`);
      new Notice(`Remote SSH: connected but failed to populate vault — ${msg}`);
      return;
    }
    new Notice(`Remote SSH: ${profile.name} ready — ${summary}`);
  }

  private cancelReconnect(): void {
    if (!this.conn.reconnectManager?.isActive()) return;
    this.conn.cancelReconnect();
    this.adapterMgr.restore();
    this.setState(SyncState.ERROR);
    new Notice('Remote SSH: reconnect cancelled');
  }

  private async startReconnect(): Promise<void> {
    if (!this.conn.activeProfile) {
      logger.warn('startReconnect: no active profile to reconnect with');
      this.setState(SyncState.ERROR);
      return;
    }
    const maxRetries = this.settings.reconnectMaxRetries ?? DEFAULT_SETTINGS.reconnectMaxRetries;
    if (maxRetries <= 0) {
      logger.info('startReconnect: auto-reconnect disabled (reconnectMaxRetries <= 0)');
      this.adapterMgr.restore();
      this.setState(SyncState.ERROR);
      return;
    }
    this.setState(SyncState.RECONNECTING);
    await this.conn.startReconnect({
      maxRetries,
      setAdapterReconnecting: (on) => this.adapterMgr.dataAdapter?.setReconnecting(on),
      onState: (s) => this.onReconnectStateChange(s),
      hooks: {
        swapClient: (c) => this.adapterMgr.dataAdapter?.swapClient(c),
        prepareListenerForReconnect: () => this.fsChangeListener.prepareForReconnect(),
        resumeListenerAfterReconnect: async (rpc) => {
          const da = this.adapterMgr.dataAdapter;
          if (da) {
            await this.fsChangeListener.resumeAfterReconnect({
              rpcConnection: rpc,
              dataAdapter: da,
            });
          }
        },
      },
    });
  }

  /**
   * Project the manager's state onto the StatusBar + Notice surface
   * and, on terminal states, clean up.
   */
  private onReconnectStateChange(s: ReconnectState): void {
    // F22 — opt-in telemetry. No-op when disabled.
    telemetry.recordReconnect(s.kind);
    if (s.kind === 'waiting') {
      const seconds = Math.max(1, Math.round(s.delayMs / 1000));
      this.statusBar.update(
        SyncState.RECONNECTING,
        `Remote SSH: Reconnecting (${s.attempt}/${s.totalAttempts}) in ${seconds}s…`,
      );
    } else if (s.kind === 'attempting') {
      this.statusBar.update(
        SyncState.RECONNECTING,
        `Remote SSH: Reconnecting (attempt ${s.attempt}/${s.totalAttempts})…`,
      );
    } else if (s.kind === 'recovered') {
      this.adapterMgr.dataAdapter?.setReconnecting(false);
      this.setState(SyncState.CONNECTED);
      new Notice('Remote SSH: reconnected');
      this.conn.reconnectManager = null;
      // Drain any writes that landed during the disconnect. Fire-and-
      // forget: the user's already-back state is independent of the
      // replay outcome, and individual op failures stay in the queue
      // for the next reconnect.
      void this.adapterMgr.replayOfflineQueue('after-reconnect');
    } else if (s.kind === 'failed') {
      // Give up: tear the patched adapter down so Obsidian falls
      // back to local file:// reads instead of blocking forever on a
      // dead transport. restore() clears dataAdapter so the
      // setReconnecting flag goes with it.
      this.adapterMgr.restore();
      this.setState(SyncState.ERROR);
      // s.reason is a string from ReconnectManager; wrap into Error
      // so classifyError can run pattern matching on the message
      // (e.g. host-key / timeout substrings still get caught).
      const { notice, classified } = classifyToNotice(new Error(s.reason));
      logger.error(`Reconnect failed: ${classified.title}`, {
        category: classified.category,
        code: classified.code,
        original: s.reason,
      });
      new Notice(notice);
      this.conn.reconnectManager = null;
    } else if (s.kind === 'cancelled') {
      this.adapterMgr.dataAdapter?.setReconnecting(false);
      this.conn.reconnectManager = null;
    }
  }

  /**
   * Idempotent: it always restores the adapter, drops the active SSH
   * client, clears `activeProfileId`, and parks the state machine on
   * IDLE. Calling it from a stale UI button (where state was already
   * IDLE because the plugin had just reloaded) is a supported flow.
   */
  async disconnect() {
    const wasActive = this.state !== SyncState.IDLE
      || this.conn.isAlive()
      || this.settings.activeProfileId !== null;
    this.conn.cancelReconnect();
    // #149 — close the terminal pane(s) before tearing the SSH
    // session down so the shell channel close fires while the ssh2
    // Client is still around (cleaner teardown logs).
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_REMOTE_TERMINAL);
    this.adapterMgr.restore();
    await this.conn.disconnectTransport();
    this.setState(SyncState.IDLE);
    if (this.settings.activeProfileId !== null) {
      this.settings.activeProfileId = null;
      await this.saveSettings();
    }
    if (wasActive) new Notice('Remote SSH: disconnected');
  }

  /**
   * Open or reveal the remote terminal pane in the right sidebar.
   * Re-using an existing leaf keeps the shell channel alive across
   * focus changes; opening a fresh leaf each time would reset
   * scrollback and lose any in-flight commands.
   *
   * Uses `setActiveLeaf` rather than `revealLeaf` because the latter
   * requires Obsidian v1.7.2 and our manifest declares
   * `minAppVersion: 1.4.0` — `setActiveLeaf` has the same observable
   * effect (focus + render) and has been stable since pre-1.0.
   */
  async openRemoteTerminal(): Promise<void> {
    if (this.openingTerminal) return;
    this.openingTerminal = true;
    try {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_REMOTE_TERMINAL);
      if (existing.length > 0) {
        this.app.workspace.setActiveLeaf(existing[0], { focus: true });
        return;
      }
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice('Remote SSH: no available workspace leaf to open the terminal in');
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_REMOTE_TERMINAL, active: true });
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    } finally {
      this.openingTerminal = false;
    }
  }

  /**
   * POC for the shadow-vault architecture (see
   * docs/en/architecture/shadow-vault.md, Phase 1): walk the patched
   * adapter, then hand the resulting entry list to `VaultModelBuilder`
   * which materialises TFile/TFolder objects in `app.vault.fileMap`
   * and fires `vault.trigger('create', file)` for each new file. File
   * Explorer should redraw with the remote tree.
   *
   * Stat is intentionally skipped per file in this POC — every entry
   * lands with zero ctime/mtime/size. Shadow-vault Phase 4 will
   * decide whether to batch-stat at walk time or stat lazily.
   *
   * Run from a vault that's already connected to a profile via the
   * existing in-place patch flow (Tier 1-A); the command is hidden
   * unless `this.conn.client?.isAlive()`.
   */
  /**
   * Walk the patched adapter and run `VaultModelBuilder` so File
   * Explorer renders the remote tree. Public so both the debug
   * command and the Phase 4 auto-connect flow share one path.
   *
   * Stat is intentionally skipped per file — every entry lands with
   * zero ctime/mtime/size. Subsequent file accesses fault in real
   * stat values via the patched adapter as needed; a Phase 6
   * follow-up can switch to a daemon-side batch-stat if it shows
   * up in profiles.
   *
   * Returns a short summary string suitable for a Notice; logs the
   * full counts + first 5 errors via `logger.info`/`logger.warn`.
   */
  async populateVaultFromRemote(label: string = 'remote'): Promise<string> {
    const start = Date.now();

    // Phase E1-α.2: prefer the daemon's `fs.walk` (one RPC, real
    // mtime+size per entry) when the active session is RPC AND the
    // daemon advertises the capability. Otherwise BulkWalker
    // transparently runs the legacy BFS via the patched adapter.
    const walker = new BulkWalker({
      adapter: this.app.vault.adapter,
      rpcConnection: this.conn.rpcConnection ?? undefined,
    });
    const walk = await walker.walk('');
    logger.info(
      `populateVaultFromRemote(${label}): ${walk.source}, ${walk.entries.length} entries ` +
      `in ${walk.walkMs}ms` +
      (walk.fastPathError ? ` (fast-path fallback: ${walk.fastPathError})` : ''),
    );

    const builder = new VaultModelBuilder(this.app.vault, { TFile, TFolder });
    const result = await builder.build(walk.entries);
    const totalMs = Date.now() - start;

    const summary =
      `${result.filesAdded}f + ${result.foldersAdded}d built, ` +
      `${result.skipped} skipped, ${result.errors.length} errors (${totalMs}ms)`;
    if (result.errors.length > 0) {
      logger.warn(
        `populateVaultFromRemote(${label}): first 5 errors: ` +
        JSON.stringify(result.errors.slice(0, 5), null, 2),
      );
    }
    return summary;
  }

  /**
   * Settings UI Connect button handler (Phase 3) and the underlying
   * implementation of the shadow-vault flow.
   *
   * Bootstraps the shadow vault for `profile` (creates the dir,
   * installs the plugin per-file, writes data.json with the
   * auto-connect marker, registers the path in obsidian.json) and
   * opens it in a new Obsidian window via the
   * `obsidian://open?path=…` URL scheme.
   *
   * Does NOT require an SSH connection — the shadow vault setup is
   * a local-disk operation; the connect happens later, inside the
   * shadow window (Phase 4).
   */
  async openShadowVaultFor(profile: SshProfile): Promise<void> {
    // Source dir: where this running plugin lives, so the shadow
    // vault's plugin install symlinks the same bundle.
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice('Remote SSH: vault is not file-system-backed; cannot locate plugin source');
      return;
    }
    const sourcePluginDir = path.join(adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id);

    // Shadow vaults live under ~/.obsidian-remote/vaults/ on every
    // OS. os.homedir() resolves at runtime — no hardcoded user.
    const baseDir = path.join(os.homedir(), '.obsidian-remote', 'vaults');

    const registry = new ObsidianRegistry(ObsidianRegistry.defaultConfigPath());
    const bootstrap = new ShadowVaultBootstrap(baseDir, sourcePluginDir, registry);
    const spawner = new WindowSpawner();
    const manager = new ShadowVaultManager(bootstrap, spawner);

    try {
      const result = await manager.openShadowFor(profile, this.settings.profiles);
      const how = result.pluginInstallMethod;
      const reg = result.registryCreated ? 'newly registered' : 'reused';
      new Notice(`Remote SSH: opened ${profile.name} in new window (${how}, ${reg})`);
      logger.info(
        `openShadowVaultFor: profile=${profile.name}, vault=${result.layout.vaultDir}, ` +
        `registry id=${result.registryId} (${reg}), plugin=${how}`,
      );
    } catch (e) {
      const msg = errorMessage(e);
      logger.error(`openShadowVaultFor: ${msg}`);
      new Notice(`Remote SSH: shadow vault failed — ${msg}`);
    }
  }

  /**
   * Manual command-palette entry point for adapter patching. Used
   * during development to inspect pre-patch behaviour or to re-patch
   * after a manual restore.
   */
  private async debugPatchAdapter(): Promise<void> {
    if (this.state !== SyncState.CONNECTED || !this.conn.activeRemoteBasePath) {
      new Notice('Remote SSH: connect first');
      return;
    }
    if (this.adapterMgr.isPatched()) {
      new Notice('Remote SSH: adapter already patched');
      return;
    }
    const transportLabel = this.conn.rpcConnection ? 'RPC' : 'SFTP';
    const ok = await this.adapterMgr.patch();
    if (ok) {
      new Notice(`Remote SSH: adapter patched via ${transportLabel}`);
    } else {
      new Notice('Remote SSH: adapter patch failed (see console.log)');
    }
  }

  private debugRestoreAdapter(): void {
    if (!this.adapterMgr.isPatched()) {
      new Notice('Remote SSH: adapter is not patched');
      return;
    }
    this.adapterMgr.restore();
    new Notice('Remote SSH: adapter restored');
  }

  private async debugListRoot(): Promise<void> {
    try {
      const out = await this.app.vault.adapter.list('');
      const via = this.adapterMgr.isPatched() ? 'PATCHED (SFTP)' : 'ORIGINAL (local)';
      logger.info(`debugListRoot via ${via}: ${out.files.length} files, ${out.folders.length} folders`);
      logger.info(`  files (first 5): ${out.files.slice(0, 5).join(', ')}`);
      logger.info(`  folders (first 5): ${out.folders.slice(0, 5).join(', ')}`);
      new Notice(`List via ${via}: ${out.files.length} files, ${out.folders.length} folders (see console.log)`);
    } catch (e) {
      logger.error(`debugListRoot failed: ${errorMessage(e)}`);
      new Notice(`debugListRoot failed: ${errorMessage(e)}`);
    }
  }

  /**
   * Full α-path round-trip with auto-deploy:
   *   1. Locate the staged daemon binary inside the plugin folder.
   *   2. Upload it over the existing SFTP session, kill any prior
   *      daemon, start the new one with `nohup`, wait for the token
   *      to land on disk.
   *   3. Open a unix-socket Duplex through the same SSH connection.
   *   4. Run `auth` + `server.info`.
   *   5. Smoke-list `activeRemoteBasePath` via `RpcRemoteFsClient`.
   *
   * Each step logs to `console.log` so the daemon and plugin can be
   * debugged in tandem. Optional overrides on the active profile
   * (`rpcSocketPath`, `rpcTokenPath`) are honoured; both default to
   * `.obsidian-remote/{server.sock,token}` (home-relative).
   */
  private async debugTestRpcTunnel(): Promise<void> {
    if (this.state !== SyncState.CONNECTED || !this.conn.client.isAlive()) {
      new Notice('Remote SSH: connect first (the tunnel rides on SFTP)');
      return;
    }
    const activeId = this.settings.activeProfileId;
    const profile = this.settings.profiles.find(p => p.id === activeId);
    if (!profile) {
      new Notice('Remote SSH: no active profile');
      return;
    }

    const localBinaryPath = this.locateDaemonBinary();
    if (!localBinaryPath) {
      new Notice(
        'Remote SSH: daemon binary not staged. ' +
        'Run `npm run build:server` (or `build:full`) and reload the plugin.',
      );
      return;
    }

    const remoteVaultRoot = normalizeRemotePath(profile.remotePath);
    const remoteBinaryPath = '.obsidian-remote/server';
    const remoteSocketPath = profile.rpcSocketPath?.trim() || '.obsidian-remote/server.sock';
    const remoteTokenPath  = profile.rpcTokenPath?.trim()  || '.obsidian-remote/token';

    logger.info(`debugTestRpcTunnel: local binary = ${localBinaryPath}`);
    logger.info(`debugTestRpcTunnel: remote vault = ${remoteVaultRoot}`);
    logger.info(`debugTestRpcTunnel: remote socket = ${remoteSocketPath}`);

    let connection: Awaited<ReturnType<typeof establishRpcConnection>> | null = null;
    try {
      const deployer = new ServerDeployer(this.conn.client);
      const deploy = await deployer.deploy({
        localBinaryPath,
        remoteBinaryPath,
        remoteVaultRoot,
        remoteSocketPath,
        remoteTokenPath,
      });
      logger.info(`debugTestRpcTunnel: daemon up; token len=${deploy.token.length}`);

      const stream = await this.conn.client.openUnixStream(deploy.remoteSocketPath);
      connection = await establishRpcConnection({ stream, token: deploy.token });

      const rpcFs = new RpcRemoteFsClient(connection.rpc);
      const entries = await rpcFs.list(remoteVaultRoot);
      logger.info(`debugTestRpcTunnel: list("${remoteVaultRoot}") returned ${entries.length} entries`);
      for (const e of entries.slice(0, 5)) {
        logger.info(`  - ${e.name} (${e.isDirectory ? 'dir' : 'file'}, ${e.size}B, mtime ${e.mtime})`);
      }
      new Notice(
        `RPC OK: daemon ${connection.info.version}, ${entries.length} entries at "${remoteVaultRoot}" ` +
        `(see console.log)`,
      );
    } catch (e) {
      const msg = errorMessage(e);
      logger.error(`debugTestRpcTunnel failed: ${msg}`);
      new Notice(`RPC test failed: ${msg}`);
    } finally {
      try { connection?.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Resolve the staged Linux/amd64 daemon binary that lives next to
   * `main.js` in the plugin's vault folder. Returns the absolute path
   * or `null` if the binary hasn't been built (run `npm run
   * build:server` to populate it). Other architectures land in
   * follow-up phases.
   */
  private locateDaemonBinary(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    const candidate = path.join(
      adapter.getBasePath(),
      this.app.vault.configDir, 'plugins', this.manifest.id,
      'server-bin', 'obsidian-remote-server-linux-amd64',
    );
    return fs.existsSync(candidate) ? candidate : null;
  }

  isConnected(): boolean {
    return this.state === SyncState.CONNECTED;
  }

  private setState(s: SyncState) {
    this.state = s;
    this.statusBar?.update(s);
  }

  /**
   * Command-palette / status-bar entry point that mirrors the
   * Settings UI's Connect button: pick a profile, then open it as a
   * shadow vault in a new Obsidian window. The original window is
   * never patched in-place anymore.
   */
  private promptConnect() {
    const { profiles } = this.settings;
    if (profiles.length === 0) {
      new Notice('Remote SSH: no profiles configured. Open settings to add one.');
      return;
    }
    new ConnectModal(
      this.app,
      profiles,
      this.authResolver,
      profile => this.openShadowVaultFor(profile),
    ).open();
  }

  private onStatusBarClick() {
    if (this.state === SyncState.IDLE || this.state === SyncState.ERROR) {
      this.promptConnect();
    } else if (this.state === SyncState.CONNECTED) {
      void this.disconnect();
    }
    this.desktopDelegate?.onunload();
  onunload(): void {
  }
}

  onunload: () => void;
};

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
  transport?: 'sftp' | 'rpc';
  jumpHost?: {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey' | 'agent';
    privateKeyPath?: string;
    passwordRef?: string;
  };
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

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;
  private mobilePreviewMode = false;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: MobileProfile[] = [];

  private getMobileReportMetaLine(): string {
    const pluginVersion = this.manifest?.version ?? 'unknown';
    const appVersion = (this.app as App & { version?: string }).version ?? 'unknown';
    const platform = Platform.isMobileApp ? 'mobile' : 'desktop';
    return `Meta: plugin=${pluginVersion}, obsidian=${appVersion}, platform=${platform}`;
  }

  private createDefaultMobileProfile(): MobileProfile {
    const id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name: 'New profile',
      host: '',
      port: 22,
      username: '',
      authMethod: 'password',
      remotePath: '',
      connectTimeoutMs: 15000,
      keepaliveIntervalMs: 15000,
      keepaliveCountMax: 3,
      transport: 'sftp',
    };
  }

  private pushMobilePreviewLog(message: string): void {
    const line = `[${new Date().toISOString()}] [session:${this.mobileSessionId || 'n/a'}] ${message}`;
    this.mobilePreviewLogs.push(line);
    if (this.mobilePreviewLogs.length > 200) {
      this.mobilePreviewLogs.shift();
    }
    console.info(`[Remote SSH][mobile-preview] ${message}`);
    void this.persistMobilePreviewState();
  }

  private async persistMobilePreviewState(): Promise<void> {
    if (!this.mobilePreviewMode) return;
    const saved = (await this.loadData()) as Record<string, unknown> | null;
    await this.saveData({
      ...(saved ?? {}),
      mobilePreviewLogs: this.mobilePreviewLogs,
      profiles: this.mobileProfiles,
    });
  }

  getMobilePreviewLogs(): string[] {
    return [...this.mobilePreviewLogs];
  }

  getMobileProfiles(): MobileProfile[] {
    return this.mobileProfiles.map(p => ({ ...p }));
  }

  async addMobileProfile(): Promise<void> {
    this.mobileProfiles.push(this.createDefaultMobileProfile());
    this.pushMobilePreviewLog(`Profile added: total=${this.mobileProfiles.length}`);
    await this.persistMobilePreviewState();
  }

  async updateMobileProfile(id: string, patch: Partial<MobileProfile>): Promise<void> {
    const idx = this.mobileProfiles.findIndex(p => p.id === id);
    if (idx < 0) return;
    this.mobileProfiles[idx] = { ...this.mobileProfiles[idx], ...patch };
    await this.persistMobilePreviewState();
  }

  async removeMobileProfile(id: string): Promise<void> {
    this.mobileProfiles = this.mobileProfiles.filter(p => p.id !== id);
    this.pushMobilePreviewLog(`Profile removed: total=${this.mobileProfiles.length}`);
    await this.persistMobilePreviewState();
  }

  async clearMobilePreviewLogs(): Promise<void> {
    this.mobilePreviewLogs = [];
    await this.persistMobilePreviewState();
  }

  runMobileVerification(): MobileVerificationResult {
    const timestamp = new Date().toISOString();
    const issues: MobileVerificationIssue[] = [];
    const warnings: string[] = [];
    const profiles = this.mobileProfiles;
    const duplicateKeys = new Map<string, number>();
    const duplicateNames = new Map<string, number>();
    const invalidProfileIds = new Set<string>();

    for (const p of profiles) {
      const profileName = p.name?.trim() || '(unnamed)';
      const host = p.host?.trim() ?? '';
      const username = p.username?.trim() ?? '';
      const remotePath = p.remotePath?.trim() ?? '';

      if (!p.name?.trim()) {
        issues.push({ profileId: p.id, profileName, field: 'name', message: 'Name is required' });
        invalidProfileIds.add(p.id);
      }
      if (!host) {
        issues.push({ profileId: p.id, profileName, field: 'host', message: 'Host is required' });
        invalidProfileIds.add(p.id);
      }
      if (!username) {
        issues.push({ profileId: p.id, profileName, field: 'username', message: 'Username is required' });
        invalidProfileIds.add(p.id);
      }
      if (!remotePath) {
        issues.push({ profileId: p.id, profileName, field: 'remotePath', message: 'Remote path is required' });
        invalidProfileIds.add(p.id);
      }
      if (!Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        issues.push({ profileId: p.id, profileName, field: 'port', message: 'Port must be between 1 and 65535' });
        invalidProfileIds.add(p.id);
      }

      if (host.includes(' ')) {
        warnings.push(`${profileName}: host contains whitespace`);
      }
      if (host === 'localhost' || host === '127.0.0.1') {
        warnings.push(`${profileName}: host points to local device (${host}); verify this is intended`);
      }
      if (remotePath && !remotePath.startsWith('/')) {
        warnings.push(`${profileName}: remote path is not absolute (${remotePath})`);
      }
      if (remotePath.endsWith('/')) {
        warnings.push(`${profileName}: remote path has trailing slash (${remotePath})`);
      }

      duplicateNames.set(profileName, (duplicateNames.get(profileName) ?? 0) + 1);
      const key = `${username}@${host}:${p.port}:${remotePath}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    }

    for (const [name, count] of duplicateNames.entries()) {
      if (name !== '(unnamed)' && count > 1) {
        warnings.push(`Duplicate profile name detected (${count}x): ${name}`);
      }
    }
    for (const [key, count] of duplicateKeys.entries()) {
      if (count > 1) {
        warnings.push(`Duplicate endpoint+path detected (${count}x): ${key}`);
      }
    }

    const status: 'PASS' | 'WARN' | 'FAIL' =
      invalidProfileIds.size > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS');

    const result: MobileVerificationResult = {
      timestamp,
      status,
      totalProfiles: profiles.length,
      invalidProfiles: invalidProfileIds.size,
      issues,
      warnings,
    };

    this.pushMobilePreviewLog(
      `Verification suite: status=${result.status}, total=${result.totalProfiles}, invalid=${result.invalidProfiles}, warnings=${result.warnings.length}`,
    );
    return result;
  }

  formatMobileVerificationReport(result: MobileVerificationResult): string {
    const lines: string[] = [];
    lines.push(`Mobile verification report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Profiles: total=${result.totalProfiles}, invalid=${result.invalidProfiles}, warnings=${result.warnings.length}`);
    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      for (const w of result.warnings) lines.push(`- ${w}`);
    }
    if (result.issues.length > 0) {
      lines.push('Issues:');
      for (const i of result.issues) {
        lines.push(`- ${i.profileName} (${i.profileId}) [${i.field}] ${i.message}`);
      }
    } else {
      lines.push('Issues: none');
    }
    return lines.join('\n');
  }

  private classifyProbeError(message: string): { outcome: 'WARN' | 'FAIL'; detail: string } {
    const m = message.toLowerCase();
    if (m.includes('timed out') || m.includes('timeout')) {
      return { outcome: 'FAIL', detail: 'timeout while reaching host/port' };
    }
    if (m.includes('ssl') || m.includes('certificate') || m.includes('handshake')) {
      return {
        outcome: 'WARN',
        detail: 'host reachable but TLS/HTTP mismatch (expected on SSH port in many cases)',
      };
    }
    if (m.includes('fetch') || m.includes('network') || m.includes('dns')) {
      return { outcome: 'FAIL', detail: 'network unreachable or host not resolvable from this device' };
    }
    return { outcome: 'WARN', detail: `indeterminate response: ${message}` };
  }

  async runMobileConnectionProbe(): Promise<MobileConnectionProbeResult> {
    const timestamp = new Date().toISOString();
    const entries: MobileConnectionProbeEntry[] = [];
    const note =
      'Best-effort probe via HTTP(S) request to host:port. This is not an SSH handshake test, '
      + 'but helps detect obvious reachability problems from mobile.';

    for (const p of this.mobileProfiles) {
      const profileName = p.name?.trim() || '(unnamed)';
      const host = p.host?.trim() ?? '';
      const remotePath = p.remotePath?.trim() ?? '';
      const username = p.username?.trim() ?? '';
      const target = `${host}:${p.port}`;

      if (!host || !username || !remotePath || !Number.isFinite(p.port) || p.port < 1 || p.port > 65535) {
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: 'SKIP',
          detail: 'profile has missing/invalid required fields',
        });
        continue;
      }

      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        // HTTP probe only: quick signal that host:port is reachable from mobile.
        await fetch(`http://${host}:${p.port}/`, {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store',
        });
        const latencyMs = Date.now() - started;
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: 'WARN',
          detail: 'port responded to HTTP probe (reachable, but service may not be SSH)',
          latencyMs,
        });
      } catch (e) {
        const latencyMs = Date.now() - started;
        const raw = e instanceof Error ? e.message : String(e);
        const classified = this.classifyProbeError(raw);
        entries.push({
          profileId: p.id,
          profileName,
          target,
          outcome: classified.outcome,
          detail: classified.detail,
          latencyMs,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    const attempted = entries.filter(e => e.outcome !== 'SKIP').length;
    const pass = entries.filter(e => e.outcome === 'PASS').length;
    const warn = entries.filter(e => e.outcome === 'WARN').length;
    const fail = entries.filter(e => e.outcome === 'FAIL').length;
    const skip = entries.filter(e => e.outcome === 'SKIP').length;
    const status: 'PASS' | 'WARN' | 'FAIL' =
      fail > 0 ? 'FAIL' : (warn > 0 ? 'WARN' : 'PASS');

    const result: MobileConnectionProbeResult = {
      timestamp,
      status,
      attempted,
      pass,
      warn,
      fail,
      skip,
      entries,
      note,
    };

    this.pushMobilePreviewLog(
      `Connection probe: status=${status}, attempted=${attempted}, pass=${pass}, warn=${warn}, fail=${fail}, skip=${skip}`,
    );

    return result;
  }

  formatMobileConnectionProbeReport(result: MobileConnectionProbeResult): string {
    const lines: string[] = [];
    lines.push(`Mobile connection probe report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(
      `Summary: attempted=${result.attempted}, pass=${result.pass}, warn=${result.warn}, fail=${result.fail}, skip=${result.skip}`,
    );
    lines.push(`Note: ${result.note}`);
    lines.push('Entries:');
    for (const e of result.entries) {
      const latency = typeof e.latencyMs === 'number' ? `, latency=${e.latencyMs}ms` : '';
      lines.push(`- ${e.profileName} (${e.target}) -> ${e.outcome}: ${e.detail}${latency}`);
    }
    if (result.entries.length === 0) {
      lines.push('- (no profiles)');
    }
    return lines.join('\n');
  }

  private toSshProfile(profile: MobileProfile): SshProfile {
    return {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      passwordRef: profile.passwordRef,
      privateKeyPath: profile.privateKeyPath,
      passphraseRef: profile.passphraseRef,
      agentSocket: profile.agentSocket,
      hostKeyFingerprint: profile.hostKeyFingerprint,
      remotePath: profile.remotePath,
      connectTimeoutMs: profile.connectTimeoutMs,
      keepaliveIntervalMs: profile.keepaliveIntervalMs,
      keepaliveCountMax: profile.keepaliveCountMax,
      transport: profile.transport,
      jumpHost: profile.jumpHost,
    };
  }

  async runMobileSshConnectTest(): Promise<MobileSshConnectResult> {
    const timestamp = new Date().toISOString();
    const note = 'Attempts a real SSH connect through SftpClient using the first configured mobile profile.';
    const attempts: MobileSshConnectAttempt[] = [];
    const profile = this.mobileProfiles[0];

    if (!profile) {
      const result: MobileSshConnectResult = {
        timestamp,
        status: 'WARN',
        attempted: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        skip: 1,
        note,
        attempts: [
          {
            profileId: '(none)',
            profileName: '(none)',
            target: '(none)',
            status: 'SKIP',
            detail: 'no profiles configured',
          },
        ],
      };
      this.pushMobilePreviewLog('SSH connect test: skipped (no profiles configured)');
      return result;
    }

    const target = `${profile.host}:${profile.port}`;
    const started = Date.now();
    try {
      const [{ SftpClient }, { AuthResolver }, { HostKeyStore }, { SecretStore }] = await Promise.all([
        import('./ssh/SftpClient'),
        import('./ssh/AuthResolver'),
        import('./ssh/HostKeyStore'),
        import('./ssh/SecretStore'),
      ]);

      const secretStore = new SecretStore();
      const authResolver = new AuthResolver(secretStore);
      const hostKeyStore = new HostKeyStore();
      const client = new SftpClient(authResolver, hostKeyStore);
      const sshProfile = this.toSshProfile(profile);

      await client.connect(sshProfile);
      await client.disconnect();

      const latencyMs = Date.now() - started;
      attempts.push({
        profileId: profile.id,
        profileName: profile.name,
        target,
        status: 'PASS',
        detail: 'SSH connect succeeded and disconnected cleanly',
        latencyMs,
      });

      const result: MobileSshConnectResult = {
        timestamp,
        status: 'PASS',
        attempted: 1,
        pass: 1,
        warn: 0,
        fail: 0,
        skip: 0,
        note,
        attempts,
      };
      this.pushMobilePreviewLog(`SSH connect test: PASS (${profile.name})`);
      return result;
    } catch (e) {
      const latencyMs = Date.now() - started;
      const message = e instanceof Error ? e.message : String(e);
      const lower = message.toLowerCase();
      const status: 'WARN' | 'FAIL' =
        lower.includes('no password stored') ||
        lower.includes('no private key path') ||
        lower.includes('ssh agent requested')
          ? 'WARN'
          : 'FAIL';
      attempts.push({
        profileId: profile.id,
        profileName: profile.name,
        target,
        status,
        detail: message,
        latencyMs,
      });

      const result: MobileSshConnectResult = {
        timestamp,
        status,
        attempted: 1,
        pass: 0,
        warn: status === 'WARN' ? 1 : 0,
        fail: status === 'FAIL' ? 1 : 0,
        skip: 0,
        note,
        attempts,
      };
      this.pushMobilePreviewLog(`SSH connect test: ${status} (${profile.name}) — ${message}`);
      return result;
    }
  }

  formatMobileSshConnectReport(result: MobileSshConnectResult): string {
    const lines: string[] = [];
    lines.push(`Mobile SSH connect test report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(
      `Summary: attempted=${result.attempted}, pass=${result.pass}, warn=${result.warn}, fail=${result.fail}, skip=${result.skip}`,
    );
    lines.push(`Note: ${result.note}`);
    lines.push('Attempts:');
    for (const a of result.attempts) {
      const latency = typeof a.latencyMs === 'number' ? `, latency=${a.latencyMs}ms` : '';
      lines.push(`- ${a.profileName} (${a.target}) -> ${a.status}: ${a.detail}${latency}`);
    }
    return lines.join('\n');
  }

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as {
      mobilePreviewLogs?: string[];
      profiles?: Array<Partial<MobileProfile>>;
    } | null;
    this.mobileSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.mobilePreviewLogs = Array.isArray(saved?.mobilePreviewLogs)
      ? saved.mobilePreviewLogs.filter((v): v is string => typeof v === 'string').slice(-200)
      : [];
    this.mobileProfiles = Array.isArray(saved?.profiles)
      ? saved.profiles
        .filter((v): v is Partial<MobileProfile> => typeof v === 'object' && v !== null)
        .map(v => ({
          ...this.createDefaultMobileProfile(),
          ...v,
          id: typeof v.id === 'string' && v.id.length > 0 ? v.id : this.createDefaultMobileProfile().id,
          port: Number.isFinite(v.port) ? Number(v.port) : 22,
          authMethod:
            v.authMethod === 'privateKey' || v.authMethod === 'agent' || v.authMethod === 'password'
              ? v.authMethod
              : 'password',
        }))
      : [];

    if (Platform.isMobileApp) {
      this.mobilePreviewMode = true;
      this.addSettingTab(new MobileSettingsTab(this.app, this));
      this.pushMobilePreviewLog('Activated mobile preview mode');
      this.addCommand({
        id: 'mobile-status',
        name: 'Mobile status (preview)',
        callback: () => {
          this.pushMobilePreviewLog('Executed command: mobile-status');
          new Notice(
            'Remote SSH: mobile preview mode. Activation succeeded; desktop runtime is gated in this phase.',
          );
        },
      });
      this.addCommand({
        id: 'mobile-copy-preview-logs',
        name: 'Mobile: copy preview logs',
        callback: () => {
          const body = this.mobilePreviewLogs.length === 0
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
          this.pushMobilePreviewLog(`Profile validation: total=${result.totalProfiles}, invalid=${result.invalidProfiles}`);
          if (result.invalidProfiles === 0) {
            new Notice(`Remote SSH: profile settings look good (${result.totalProfiles} profiles)`);
            return;
          }
          new Notice(`Remote SSH: ${result.invalidProfiles}/${result.totalProfiles} profiles have invalid fields`);
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
            new Notice(`Remote SSH: connection probe completed with ${result.warn} warnings`);
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
          this.pushMobilePreviewLog('Executed command: mobile-copy-connection-probe-report');
          new Notice('Remote SSH: connection probe report copied');
        },
      });
      new Notice('Remote SSH: mobile preview mode enabled');
      return;
    }

    const mod = await import('./main.desktop');
    const DesktopPluginClass = mod.default as new (app: App, manifest: PluginManifest) => DesktopPlugin;
    this.desktopDelegate = new DesktopPluginClass(this.app, this.manifest);
    await this.desktopDelegate.onload();
  }

  onunload(): void {
    if (this.mobilePreviewMode) {
      this.pushMobilePreviewLog('Unloaded mobile preview mode');
      return;
    }
    this.desktopDelegate?.onunload();
  }
}

>>>>>>> feat(mobile): add preview settings/logs and persist mobile events





