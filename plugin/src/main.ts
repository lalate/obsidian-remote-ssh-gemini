import { Notice, Platform, Plugin, requestUrl } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { MobileSettingsTab } from './settings/MobileSettingsTab';
import type { SshProfile } from './types';

type DesktopPlugin = Plugin & {
  onload: () => Promise<void>;
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
  transport?: 'sftp' | 'rpc' | 'relay-rpc';
  relayBaseUrl?: string;
  relayAuthToken?: string;
  relayRpcUsername?: string;
  relayRpcPassword?: string;
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

type MobileRelayConfig = {
  endpoint: string;
  authToken?: string;
  rpcUsername?: string;
  rpcPassword?: string;
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

export default class RemoteSshPlugin extends Plugin {
  private desktopDelegate: DesktopPlugin | null = null;
  private mobilePreviewMode = false;
  private mobilePreviewLogs: string[] = [];
  private mobileSessionId = '';
  private mobileProfiles: MobileProfile[] = [];
  private mobileRelayConfig: MobileRelayConfig = { endpoint: '' };

  private ensureBufferGlobal(): void {
    if (this.hasBufferGlobal()) {
      return;
    }

    const runtime = globalThis as typeof globalThis & {
      Buffer?: unknown;
      require?: (id: string) => unknown;
    };

    const req = runtime.require;
    if (typeof req !== 'function') {
      return;
    }

    try {
      const maybeBufferModule = req('buffer') as { Buffer?: unknown } | undefined;
      if (maybeBufferModule?.Buffer) {
        runtime.Buffer = maybeBufferModule.Buffer as BufferConstructor;
        this.pushMobilePreviewLog('Buffer global initialized from runtime module');
      }
    } catch {
      // Keep running even when the runtime does not expose the buffer module.
    }
  }

  private hasBufferGlobal(): boolean {
    return typeof (globalThis as { Buffer?: unknown }).Buffer !== 'undefined';
  }

  private getRuntimeCapabilitySummary(): string {
    const runtime = globalThis as typeof globalThis & {
      Buffer?: unknown;
      require?: unknown;
      process?: { versions?: { node?: string } };
    };
    const hasBuffer = typeof runtime.Buffer !== 'undefined';
    const hasRequire = typeof runtime.require === 'function';
    const nodeVersion = runtime.process?.versions?.node;
    return `capabilities: buffer=${hasBuffer}, require=${hasRequire}, node=${nodeVersion ?? 'none'}`;
  }

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
      relayBaseUrl: '',
      relayAuthToken: '',
      relayRpcUsername: '',
      relayRpcPassword: '',
    };
  }

  private getPrimaryMobileProfile(): MobileProfile | undefined {
    const relayProfile = this.mobileProfiles.find(p => (p.transport ?? 'sftp') === 'relay-rpc');
    return relayProfile ?? this.mobileProfiles[0];
  }

  private resolveRelayRuntimeConfig(profile?: MobileProfile): {
    endpoint: string;
    authToken?: string;
    rpcUsername: string;
    rpcPassword: string;
  } {
    const endpoint = profile?.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint.trim();
    const authToken = profile?.relayAuthToken?.trim() || this.mobileRelayConfig.authToken?.trim() || undefined;
    const rpcUsername = profile?.relayRpcUsername?.trim() || this.mobileRelayConfig.rpcUsername?.trim() || 'admin';
    const rpcPassword = profile?.relayRpcPassword?.trim() || this.mobileRelayConfig.rpcPassword?.trim() || 'password';
    return {
      endpoint,
      authToken,
      rpcUsername,
      rpcPassword,
    };
  }

  private createDefaultMobileRelayConfig(): MobileRelayConfig {
    return {
      endpoint: '',
      authToken: '',
      rpcUsername: '',
      rpcPassword: '',
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
      relay: this.mobileRelayConfig,
    });
  }

  getMobilePreviewLogs(): string[] {
    return [...this.mobilePreviewLogs];
  }

  getMobileProfiles(): MobileProfile[] {
    return this.mobileProfiles.map(p => ({ ...p }));
  }

  getMobileRelayConfig(): MobileRelayConfig {
    return { ...this.mobileRelayConfig };
  }

  async updateMobileRelayConfig(patch: Partial<MobileRelayConfig>): Promise<void> {
    this.mobileRelayConfig = { ...this.mobileRelayConfig, ...patch };
    await this.persistMobilePreviewState();
  }

  async runMobileRelayProbe(): Promise<MobileRelayProbeResult> {
    const timestamp = new Date().toISOString();
    const endpoint = this.mobileRelayConfig.endpoint.trim();
    const note =
      'Mobile runtime lacks Node APIs in this environment, so direct SSH is unavailable. '
      + 'Use relay endpoint reachability as the mobile connectivity gate.';

    if (!endpoint) {
      const result: MobileRelayProbeResult = {
        timestamp,
        status: 'WARN',
        endpoint,
        detail: 'relay endpoint is not configured',
        note,
      };
      this.pushMobilePreviewLog('Relay probe: skipped (endpoint not configured)');
      return result;
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      const result: MobileRelayProbeResult = {
        timestamp,
        status: 'FAIL',
        endpoint,
        detail: 'relay endpoint is not a valid URL',
        note,
      };
      this.pushMobilePreviewLog('Relay probe: FAIL (invalid endpoint URL)');
      return result;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      const result: MobileRelayProbeResult = {
        timestamp,
        status: 'FAIL',
        endpoint: url.toString(),
        detail: `relay endpoint must use http/https (received: ${url.protocol})`,
        note,
      };
      this.pushMobilePreviewLog(`Relay probe: FAIL (unsupported scheme: ${url.protocol})`);
      return result;
    }

    const host = url.hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com') || host.includes('githubusercontent.com')) {
      const result: MobileRelayProbeResult = {
        timestamp,
        status: 'WARN',
        endpoint: url.toString(),
        detail: 'configured endpoint looks like a GitHub page, not a relay API/health endpoint',
        note,
      };
      this.pushMobilePreviewLog(`Relay probe: WARN (${url.toString()}) — likely non-relay endpoint`);
      return result;
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {
      Accept: 'application/json,text/plain,*/*',
      'Cache-Control': 'no-store',
    };
    const token = this.mobileRelayConfig.authToken?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await requestUrl({
        url: url.toString(),
        method: 'GET',
        headers,
        throw: false,
      });
      const latencyMs = Date.now() - started;

      const status: 'PASS' | 'WARN' = response.status >= 200 && response.status < 300 ? 'PASS' : 'WARN';
      const detail = response.status >= 200 && response.status < 300
        ? `relay endpoint reachable (HTTP ${response.status})`
        : `relay endpoint responded but returned HTTP ${response.status}`;

      const result: MobileRelayProbeResult = {
        timestamp,
        status,
        endpoint: url.toString(),
        latencyMs,
        httpStatus: response.status,
        detail,
        note,
      };
      this.pushMobilePreviewLog(`Relay probe: ${status} (${url.toString()}, http=${response.status}, latency=${latencyMs}ms)`);
      return result;
    } catch (requestErr) {
      let fetchErrMessage = '';
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers,
          signal: controller.signal,
          cache: 'no-store',
        });
        const latencyMs = Date.now() - started;
        const status: 'PASS' | 'WARN' = response.ok ? 'PASS' : 'WARN';
        const detail = response.ok
          ? `relay endpoint reachable via fetch fallback (HTTP ${response.status})`
          : `relay endpoint responded via fetch fallback but returned HTTP ${response.status}`;
        const result: MobileRelayProbeResult = {
          timestamp,
          status,
          endpoint: url.toString(),
          latencyMs,
          httpStatus: response.status,
          detail,
          note,
        };
        this.pushMobilePreviewLog(
          `Relay probe: ${status} via fetch fallback (${url.toString()}, http=${response.status}, latency=${latencyMs}ms)`,
        );
        return result;
      } catch (fetchErr) {
        fetchErrMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      }

      const latencyMs = Date.now() - started;
      const requestErrMessage = requestErr instanceof Error ? requestErr.message : String(requestErr);
      const timeoutHit = requestErrMessage.toLowerCase().includes('abort') || fetchErrMessage.toLowerCase().includes('abort');
      const detail = timeoutHit
        ? 'relay probe timed out after 5000ms'
        : `relay probe network error: requestUrl=${requestErrMessage}; fetch=${fetchErrMessage || 'n/a'}`;
      const result: MobileRelayProbeResult = {
        timestamp,
        status: 'FAIL',
        endpoint: url.toString(),
        latencyMs,
        detail,
        note,
      };
      this.pushMobilePreviewLog(`Relay probe: FAIL (${url.toString()}) — ${detail}`);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  formatMobileRelayProbeReport(result: MobileRelayProbeResult): string {
    const lines: string[] = [];
    lines.push(`Mobile relay probe report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Endpoint: ${result.endpoint || '(not configured)'}`);
    if (typeof result.httpStatus === 'number') {
      lines.push(`HTTP status: ${result.httpStatus}`);
    }
    if (typeof result.latencyMs === 'number') {
      lines.push(`Latency: ${result.latencyMs}ms`);
    }
    lines.push(`Detail: ${result.detail}`);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
  }

  private deriveRelayConnectUrl(endpoint: string): string {
    const url = new URL(endpoint);
    return `${url.origin}/v1/connect`;
  }

  private parseRelayConnectBody(rawText: string): RelayConnectApiBody {
    if (!rawText) {
      return {};
    }
    try {
      return JSON.parse(rawText) as RelayConnectApiBody;
    } catch {
      return {};
    }
  }

  async runMobileRelayConnectTest(): Promise<MobileRelayConnectResult> {
    const timestamp = new Date().toISOString();
    const profile = this.getPrimaryMobileProfile();
    const relayConfig = this.resolveRelayRuntimeConfig(profile);
    const endpoint = relayConfig.endpoint;
    const note =
      'Posts the active mobile profile to relay /v1/connect using profile transport settings '
      + '(fallback: global relay settings).';

    if (!endpoint) {
      const result: MobileRelayConnectResult = {
        timestamp,
        status: 'WARN',
        endpoint,
        detail: 'relay endpoint is not configured',
        note,
      };
      this.pushMobilePreviewLog('Relay connect test: skipped (endpoint not configured)');
      return result;
    }

    let connectUrl = '';
    try {
      connectUrl = this.deriveRelayConnectUrl(endpoint);
    } catch {
      const result: MobileRelayConnectResult = {
        timestamp,
        status: 'FAIL',
        endpoint,
        detail: 'relay endpoint is not a valid URL',
        note,
      };
      this.pushMobilePreviewLog('Relay connect test: FAIL (invalid endpoint URL)');
      return result;
    }

    if (!profile) {
      const result: MobileRelayConnectResult = {
        timestamp,
        status: 'WARN',
        endpoint: connectUrl,
        detail: 'no profiles configured',
        note,
      };
      this.pushMobilePreviewLog('Relay connect test: skipped (no profiles configured)');
      return result;
    }

    const host = profile.host?.trim() ?? '';
    const username = profile.username?.trim() ?? '';
    const remotePath = profile.remotePath?.trim() ?? '';
    if (!host || !username || !remotePath || !Number.isFinite(profile.port) || profile.port < 1 || profile.port > 65535) {
      const result: MobileRelayConnectResult = {
        timestamp,
        status: 'WARN',
        endpoint: connectUrl,
        detail: 'first profile has missing/invalid required fields (host, port, username, remotePath)',
        note,
      };
      this.pushMobilePreviewLog('Relay connect test: skipped (first profile invalid)');
      return result;
    }

    const started = Date.now();
    const headers: Record<string, string> = {
      Accept: 'application/json,text/plain,*/*',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    const token = relayConfig.authToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const body = JSON.stringify({
      requestId: `mobile-${Date.now().toString(36)}`,
      host,
      port: profile.port,
      username,
      remotePath,
    });

    try {
      const response = await requestUrl({
        url: connectUrl,
        method: 'POST',
        headers,
        body,
        throw: false,
      });
      const latencyMs = Date.now() - started;
      const rawText = typeof response.text === 'string' ? response.text : '';
      let parsed = this.parseRelayConnectBody(rawText);
      let code = typeof parsed.code === 'string' ? parsed.code : undefined;
      let message = typeof parsed.message === 'string' ? parsed.message : '';
      let sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;
      let streamUrl = typeof parsed.streamUrl === 'string' ? parsed.streamUrl : undefined;

      // iOS runtime sometimes returns 2xx with an empty requestUrl body.
      // Retry with fetch to recover streamUrl/sessionId before judging result.
      if (response.status >= 200 && response.status < 300 && !streamUrl) {
        try {
          const fetchResponse = await fetch(connectUrl, {
            method: 'POST',
            headers,
            body,
            cache: 'no-store',
          });
          if (fetchResponse.ok) {
            const fetchText = await fetchResponse.text();
            const parsedFetch = this.parseRelayConnectBody(fetchText);
            if (typeof parsedFetch.streamUrl === 'string') {
              parsed = parsedFetch;
              code = typeof parsed.code === 'string' ? parsed.code : undefined;
              message = typeof parsed.message === 'string' ? parsed.message : '';
              sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;
              streamUrl = parsedFetch.streamUrl;
              this.pushMobilePreviewLog('Relay connect test: recovered streamUrl via fetch body retry');
            }
          }
        } catch {
          // Keep original requestUrl result when fetch retry is unavailable.
        }
      }

      let status: 'PASS' | 'WARN' | 'FAIL' = 'FAIL';
      if (response.status >= 200 && response.status < 300) {
        if (code === 'NOT_IMPLEMENTED') {
          status = 'WARN';
        } else if (code === 'TARGET_UNREACHABLE') {
          status = 'FAIL';
        } else if (parsed.ok === true || code === 'PRECHECK_OK') {
          status = 'PASS';
        } else {
          status = 'WARN';
        }
      }

      const detail =
        response.status >= 200 && response.status < 300
          ? `relay connect responded (HTTP ${response.status}${code ? `, code=${code}` : ''}${message ? `, message=${message}` : ''})`
          : `relay connect failed with HTTP ${response.status}`;

      const result: MobileRelayConnectResult = {
        timestamp,
        status,
        endpoint: connectUrl,
        latencyMs,
        httpStatus: response.status,
        code,
        sessionId,
        streamUrl,
        detail,
        note,
      };
      this.pushMobilePreviewLog(
        `Relay connect test: ${status} (${connectUrl}, http=${response.status}${code ? `, code=${code}` : ''}, latency=${latencyMs}ms)`,
      );
      return result;
    } catch (requestErr) {
      const latencyMs = Date.now() - started;
      const requestErrMessage = requestErr instanceof Error ? requestErr.message : String(requestErr);
      let fetchErrMessage = '';

      try {
        const fetchResponse = await fetch(connectUrl, {
          method: 'POST',
          headers,
          body,
          cache: 'no-store',
        });
        const responseText = await fetchResponse.text();
        const parsed = this.parseRelayConnectBody(responseText);
        const code = typeof parsed.code === 'string' ? parsed.code : undefined;
        const message = typeof parsed.message === 'string' ? parsed.message : '';
        const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;
        const streamUrl = typeof parsed.streamUrl === 'string' ? parsed.streamUrl : undefined;

        const status: 'PASS' | 'WARN' | 'FAIL' = fetchResponse.ok
          ? (code === 'NOT_IMPLEMENTED'
            ? 'WARN'
            : (code === 'TARGET_UNREACHABLE'
              ? 'FAIL'
              : (parsed.ok === true || code === 'PRECHECK_OK' ? 'PASS' : 'WARN')))
          : 'FAIL';
        const detail = fetchResponse.ok
          ? `relay connect responded via fetch fallback (HTTP ${fetchResponse.status}${code ? `, code=${code}` : ''}${message ? `, message=${message}` : ''})`
          : `relay connect failed via fetch fallback with HTTP ${fetchResponse.status}`;

        const result: MobileRelayConnectResult = {
          timestamp,
          status,
          endpoint: connectUrl,
          latencyMs,
          httpStatus: fetchResponse.status,
          code,
          sessionId,
          streamUrl,
          detail,
          note,
        };
        this.pushMobilePreviewLog(
          `Relay connect test: ${status} via fetch fallback (${connectUrl}, http=${fetchResponse.status}${code ? `, code=${code}` : ''}, latency=${latencyMs}ms)`,
        );
        return result;
      } catch (fetchErr) {
        fetchErrMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      }

      const timeoutHit = requestErrMessage.toLowerCase().includes('abort') || fetchErrMessage.toLowerCase().includes('abort');
      const detail = timeoutHit
        ? 'relay connect test timed out'
        : `relay connect network error: requestUrl=${requestErrMessage}; fetch=${fetchErrMessage || 'n/a'}`;

      const result: MobileRelayConnectResult = {
        timestamp,
        status: 'FAIL',
        endpoint: connectUrl,
        latencyMs,
        detail,
        note,
      };
      this.pushMobilePreviewLog(`Relay connect test: FAIL (${connectUrl}) — ${detail}`);
      return result;
    }
  }

  formatMobileRelayConnectReport(result: MobileRelayConnectResult): string {
    const lines: string[] = [];
    lines.push(`Mobile relay connect test report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Endpoint: ${result.endpoint || '(not configured)'}`);
    if (typeof result.httpStatus === 'number') {
      lines.push(`HTTP status: ${result.httpStatus}`);
    }
    if (result.code) {
      lines.push(`Relay code: ${result.code}`);
    }
    if (result.sessionId) {
      lines.push(`Session ID: ${result.sessionId}`);
    }
    if (result.streamUrl) {
      lines.push(`Stream URL: ${result.streamUrl}`);
    }
    if (typeof result.latencyMs === 'number') {
      lines.push(`Latency: ${result.latencyMs}ms`);
    }
    lines.push(`Detail: ${result.detail}`);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
  }

  async runMobileRelayStreamTest(): Promise<MobileRelayStreamResult> {
    const timestamp = new Date().toISOString();
    const note =
      'Runs relay connect first, then opens websocket stream URL and waits for session.ready. '
      + 'This validates stream handshake before RPC framing is wired.';

    const connect = await this.runMobileRelayConnectTest();
    if (connect.status === 'FAIL') {
      return {
        timestamp,
        status: 'FAIL',
        endpoint: connect.endpoint,
        sessionId: connect.sessionId,
        streamUrl: connect.streamUrl,
        relayCode: connect.code,
        latencyMs: connect.latencyMs,
        detail: `relay connect failed before stream test: ${connect.detail}`,
        note,
      };
    }

    if (!connect.streamUrl) {
      return {
        timestamp,
        status: 'WARN',
        endpoint: connect.endpoint,
        sessionId: connect.sessionId,
        streamUrl: connect.streamUrl,
        relayCode: connect.code,
        latencyMs: connect.latencyMs,
        detail: `relay connect did not provide streamUrl (${connect.detail})`,
        note,
      };
    }

    const started = Date.now();

    try {
      const wsResult = await new Promise<{ type: string; message: string }>((resolve, reject) => {
        const ws = new WebSocket(connect.streamUrl!);
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch {
            // no-op
          }
          reject(new Error('relay stream websocket timed out after 5000ms'));
        }, 5000);

        ws.onmessage = evt => {
          if (settled) return;
          if (typeof evt.data !== 'string') {
            return;
          }
          try {
            const parsed = JSON.parse(evt.data) as { type?: string; message?: string };
            if (parsed.type === 'session.ready') {
              settled = true;
              clearTimeout(timer);
              try {
                ws.close();
              } catch {
                // no-op
              }
              resolve({ type: parsed.type, message: parsed.message ?? '' });
            }
          } catch {
            // Ignore non-JSON text frames.
          }
        };

        ws.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('relay stream websocket error'));
        };

        ws.onclose = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('relay stream websocket closed before session.ready'));
        };
      });

      const latencyMs = Date.now() - started;
      const result: MobileRelayStreamResult = {
        timestamp,
        status: 'PASS',
        endpoint: connect.endpoint,
        sessionId: connect.sessionId,
        streamUrl: connect.streamUrl,
        relayCode: connect.code,
        latencyMs,
        detail: `stream handshake ok (${wsResult.type}${wsResult.message ? `: ${wsResult.message}` : ''})`,
        note,
      };
      this.pushMobilePreviewLog(
        `Relay stream test: PASS (${connect.streamUrl}, latency=${latencyMs}ms, session=${connect.sessionId ?? 'n/a'})`,
      );
      return result;
    } catch (e) {
      const latencyMs = Date.now() - started;
      const message = e instanceof Error ? e.message : String(e);
      const result: MobileRelayStreamResult = {
        timestamp,
        status: 'FAIL',
        endpoint: connect.endpoint,
        sessionId: connect.sessionId,
        streamUrl: connect.streamUrl,
        relayCode: connect.code,
        latencyMs,
        detail: message,
        note,
      };
      this.pushMobilePreviewLog(
        `Relay stream test: FAIL (${connect.streamUrl}, latency=${latencyMs}ms) — ${message}`,
      );
      return result;
    }
  }

  formatMobileRelayStreamReport(result: MobileRelayStreamResult): string {
    const lines: string[] = [];
    lines.push(`Mobile relay stream test report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Endpoint: ${result.endpoint || '(not configured)'}`);
    if (result.relayCode) {
      lines.push(`Relay code: ${result.relayCode}`);
    }
    if (result.sessionId) {
      lines.push(`Session ID: ${result.sessionId}`);
    }
    if (result.streamUrl) {
      lines.push(`Stream URL: ${result.streamUrl}`);
    }
    if (typeof result.latencyMs === 'number') {
      lines.push(`Latency: ${result.latencyMs}ms`);
    }
    lines.push(`Detail: ${result.detail}`);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
  }

  async runMobileRelayRpcTest(): Promise<MobileRelayRpcResult> {
    const timestamp = new Date().toISOString();
    const note =
      'Runs relay connect, opens WebSocket stream, waits for session.ready, '
      + 'then performs JSON-RPC auth/server.info/fs.write/fs.read handshake.';

    const stream = await this.runMobileRelayStreamTest();
    if (stream.status === 'FAIL') {
      return {
        timestamp,
        status: 'FAIL',
        endpoint: stream.endpoint,
        sessionId: stream.sessionId,
        streamUrl: stream.streamUrl,
        relayCode: stream.relayCode,
        latencyMs: stream.latencyMs,
        detail: `stream test failed before RPC: ${stream.detail}`,
        note,
      };
    }
    if (!stream.streamUrl) {
      return {
        timestamp,
        status: 'WARN',
        endpoint: stream.endpoint,
        detail: `stream test did not provide streamUrl (${stream.detail})`,
        note,
      };
    }

    // Re-open a fresh WebSocket session for the RPC handshake.
    const profile = this.getPrimaryMobileProfile();
    const relayConfig = this.resolveRelayRuntimeConfig(profile);
    const endpoint = relayConfig.endpoint;
    const rpcUsername = relayConfig.rpcUsername;
    const rpcPassword = relayConfig.rpcPassword;
    const fsPath = `${profile?.remotePath?.trim() || '/vault'}/.relay-rpc-smoke.txt`;
    const fsContent = `relay-rpc-smoke:${Date.now()}`;

    const started = Date.now();
    try {
      const { establishRelayWsConnection } = await import('./transport/RelayWsConnection');
      const conn = await establishRelayWsConnection({
        baseUrl: new URL(endpoint).origin,
        target: {
          host: profile?.host?.trim() ?? '',
          port: profile?.port ?? 22,
          username: profile?.username?.trim() ?? '',
          remotePath: profile?.remotePath?.trim() ?? '',
        },
        authToken: relayConfig.authToken,
        rpcCredentials: { username: rpcUsername, password: rpcPassword },
      });

      let serverName: string | undefined;
      let serverVersion: string | undefined;
      try {
        const info = await conn.rpc.call<{ name?: string; version?: string }>('server.info', {});
        serverName = info.name;
        serverVersion = info.version;

        await conn.rpc.call('fs.write', { path: fsPath, content: fsContent });
        const fsRead = await conn.rpc.call<{ path?: string; content?: string }>('fs.read', { path: fsPath });
        if (typeof fsRead.path !== 'string') {
          throw new Error('fs.read did not return path');
        }
      } finally {
        conn.close();
      }

      const latencyMs = Date.now() - started;
      const result: MobileRelayRpcResult = {
        timestamp,
        status: 'PASS',
        endpoint,
        sessionId: conn.sessionId,
        streamUrl: conn.streamUrl,
        latencyMs,
        serverName,
        serverVersion,
        fsPath,
        detail: `auth/server.info/fs.write/fs.read ok; server=${serverName ?? '?'} version=${serverVersion ?? '?'}`,
        note,
      };
      this.pushMobilePreviewLog(
        `Relay RPC test: PASS (${endpoint}, latency=${latencyMs}ms, server=${serverName ?? '?'})`,
      );
      return result;
    } catch (e) {
      const latencyMs = Date.now() - started;
      const message = e instanceof Error ? e.message : String(e);
      const result: MobileRelayRpcResult = {
        timestamp,
        status: 'FAIL',
        endpoint,
        latencyMs,
        detail: message,
        note,
      };
      this.pushMobilePreviewLog(`Relay RPC test: FAIL (${endpoint}) — ${message}`);
      return result;
    }
  }

  formatMobileRelayRpcReport(result: MobileRelayRpcResult): string {
    const lines: string[] = [];
    lines.push(`Mobile relay RPC test report @ ${result.timestamp}`);
    lines.push(this.getMobileReportMetaLine());
    lines.push(`Status: ${result.status}`);
    lines.push(`Endpoint: ${result.endpoint || '(not configured)'}`);
    if (result.relayCode) lines.push(`Relay code: ${result.relayCode}`);
    if (result.sessionId) lines.push(`Session ID: ${result.sessionId}`);
    if (result.streamUrl) lines.push(`Stream URL: ${result.streamUrl}`);
    if (result.serverName) lines.push(`Server name: ${result.serverName}`);
    if (result.serverVersion) lines.push(`Server version: ${result.serverVersion}`);
    if (result.fsPath) lines.push(`FS path: ${result.fsPath}`);
    if (typeof result.latencyMs === 'number') lines.push(`Latency: ${result.latencyMs}ms`);
    lines.push(`Detail: ${result.detail}`);
    lines.push(`Note: ${result.note}`);
    return lines.join('\n');
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

      const transport = p.transport ?? 'sftp';
      if (transport !== 'relay-rpc') {
        warnings.push(
          `${profileName}: transport=${transport}; mobile desktop-equivalent path is relay-rpc (direct SSH can fail by runtime)`,
        );
      }
      if (transport === 'relay-rpc') {
        const relayEndpoint = p.relayBaseUrl?.trim() || this.mobileRelayConfig.endpoint.trim();
        if (!relayEndpoint) {
          warnings.push(`${profileName}: transport=relay-rpc but relay endpoint is not configured`);
        }
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

  private shouldRetryRelayRpcFailure(detail: string): boolean {
    const d = detail.toLowerCase();
    return (
      d.includes('timed out')
      || d.includes('timeout')
      || d.includes('websocket')
      || d.includes('network')
      || d.includes('fetch')
      || d.includes('closed before session.ready')
      || d.includes('stream test failed before rpc')
    );
  }

  private async waitMs(ms: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
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
      relayBaseUrl: profile.relayBaseUrl,
      relayAuthToken: profile.relayAuthToken,
      relayRpcUsername: profile.relayRpcUsername,
      relayRpcPassword: profile.relayRpcPassword,
      jumpHost: profile.jumpHost,
    };
  }

  async runMobileSshConnectTest(): Promise<MobileSshConnectResult> {
    const timestamp = new Date().toISOString();
    const note = 'Attempts a real SSH connect through SftpClient using the active mobile profile.';
    const attempts: MobileSshConnectAttempt[] = [];
    const profile = this.getPrimaryMobileProfile();
    const relayConfig = this.resolveRelayRuntimeConfig(profile);
    const profileTransport = profile?.transport ?? 'sftp';

    // Desktop parity on mobile: honor profile transport first.
    if (profileTransport === 'relay-rpc' || relayConfig.endpoint.length > 0) {
      const maxRelayAttempts = 3;
      let relay = await this.runMobileRelayRpcTest();
      let relayAttempts = 1;
      while (
        relay.status === 'FAIL'
        && relayAttempts < maxRelayAttempts
        && this.shouldRetryRelayRpcFailure(relay.detail)
      ) {
        const backoffMs = 400 * relayAttempts;
        this.pushMobilePreviewLog(
          `Relay mainline retry: attempt=${relayAttempts + 1}/${maxRelayAttempts}, backoff=${backoffMs}ms`,
        );
        await this.waitMs(backoffMs);
        relay = await this.runMobileRelayRpcTest();
        relayAttempts += 1;
      }
      const mappedStatus: 'PASS' | 'WARN' | 'FAIL' = relay.status;
      const attempt: MobileSshConnectAttempt = {
        profileId: profile?.id ?? '(none)',
        profileName: profile?.name ?? '(none)',
        target: relay.endpoint || '(relay endpoint not configured)',
        status: mappedStatus,
        detail:
          `relay mainline: ${relay.detail}; attempts=${relayAttempts}`
          + (relay.streamUrl ? ` (stream=${relay.streamUrl})` : ''),
        latencyMs: relay.latencyMs,
      };
      return {
        timestamp,
        status: mappedStatus,
        attempted: 1,
        pass: mappedStatus === 'PASS' ? 1 : 0,
        warn: mappedStatus === 'WARN' ? 1 : 0,
        fail: mappedStatus === 'FAIL' ? 1 : 0,
        skip: 0,
        note:
          'Transport is relay-rpc (or relay endpoint is configured), so mobile mainline connect test '
          + `uses relay JSON-RPC (auth/server.info/fs.write/fs.read) instead of direct SSH. retry<=${maxRelayAttempts}.`,
        attempts: [attempt],
      };
    }

    if (!this.hasBufferGlobal()) {
      const capabilitySummary = this.getRuntimeCapabilitySummary();
      const result: MobileSshConnectResult = {
        timestamp,
        status: 'WARN',
        attempted: 0,
        pass: 0,
        warn: 1,
        fail: 0,
        skip: 1,
        note,
        attempts: [
          {
            profileId: '(none)',
            profileName: '(none)',
            target: '(none)',
            status: 'WARN',
            detail: `Buffer global is unavailable in this runtime; SSH connect test cannot start (${capabilitySummary})`,
          },
        ],
      };
      this.pushMobilePreviewLog(`SSH connect test: skipped (Buffer global unavailable; ${capabilitySummary})`);
      return result;
    }

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
    this.ensureBufferGlobal();
    const saved = (await this.loadData()) as {
      mobilePreviewLogs?: string[];
      profiles?: Array<Partial<MobileProfile>>;
      relay?: Partial<MobileRelayConfig>;
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
          transport:
            v.transport === 'sftp' || v.transport === 'rpc' || v.transport === 'relay-rpc'
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

