import { requestUrl } from 'obsidian';
import { RelayWsRpcClient } from './RelayWsRpcClient';

export interface RelayConnectTarget {
  host: string;
  port: number;
  username: string;
  remotePath: string;
}

export interface RelayConnectInputs {
  /** Relay base URL, e.g. "https://relay.example.com" or "http://localhost:8080". */
  baseUrl: string;
  /** SSH target forwarded to relay /v1/connect. */
  target: RelayConnectTarget;
  /** HTTP bearer token for relay probe auth, if any. */
  authToken?: string;
  /** Credentials for JSON-RPC auth handshake over the WebSocket session. */
  rpcCredentials: { username: string; password: string };
  /** WebSocket open + session.ready timeout in ms. Default 10 000. */
  timeoutMs?: number;
}

export interface RelayWsConnection {
  rpc: RelayWsRpcClient;
  sessionId: string;
  streamUrl: string;
  close(): void;
}

/**
 * Establish an authenticated JSON-RPC 2.0 session over the relay WebSocket.
 *
 * Steps:
 *   1. POST `<baseUrl>/v1/connect` → receive `sessionId` + `streamUrl`
 *   2. Open WebSocket to `streamUrl`
 *   3. Wait for `{"type":"session.ready"}` frame
 *   4. Call `auth { username, password }` and verify `status === "success"`
 *   5. Return `{ rpc, sessionId, streamUrl, close }`
 *
 * Throws on any failure; caller is responsible for catching and reporting.
 */
export async function establishRelayWsConnection(
  inputs: RelayConnectInputs,
): Promise<RelayWsConnection> {
  const origin = new URL(inputs.baseUrl).origin;
  const connectUrl = `${origin}/v1/connect`;
  const timeoutMs = inputs.timeoutMs ?? 10_000;

  // ── step 1: POST /v1/connect ──────────────────────────────────────────────
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (inputs.authToken) {
    headers['Authorization'] = `Bearer ${inputs.authToken}`;
  }

  let connectResp;
  try {
    connectResp = await requestUrl({
      url: connectUrl,
      method: 'POST',
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        host: inputs.target.host,
        port: inputs.target.port,
        username: inputs.target.username,
        remotePath: inputs.target.remotePath,
      }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`relay /v1/connect request failed: ${detail}`);
  }
  if (connectResp.status < 200 || connectResp.status >= 300) {
    throw new Error(`relay /v1/connect failed: HTTP ${connectResp.status}`);
  }
  const connectJson = connectResp.json as {
    code?: string;
    sessionId?: string;
    streamUrl?: string;
    message?: string;
  };
  if (!connectJson.streamUrl || !connectJson.sessionId) {
    throw new Error(
      `relay /v1/connect response missing sessionId/streamUrl: ${connectJson.message ?? connectJson.code ?? '(no detail)'}`,
    );
  }
  const { sessionId, streamUrl } = connectJson;

  // ── step 2+3: open WebSocket, wait for session.ready ─────────────────────
  const rpc = await new Promise<RelayWsRpcClient>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(streamUrl);

    const timer = activeWindow.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`relay WebSocket session.ready timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.onmessage = (evt) => {
      if (settled || typeof evt.data !== 'string') return;
      try {
        const frame = JSON.parse(evt.data) as { type?: string };
        if (frame.type === 'session.ready') {
          settled = true;
          activeWindow.clearTimeout(timer);
          // Hand the already-open socket to RelayWsRpcClient.
          // The constructor immediately overrides ws.onmessage so all
          // subsequent frames are handled by the RPC client.
          resolve(new RelayWsRpcClient(ws));
        }
      } catch {
        // Ignore malformed frames before session.ready.
      }
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      activeWindow.clearTimeout(timer);
      reject(new Error('relay WebSocket error before session.ready'));
    };
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      activeWindow.clearTimeout(timer);
      reject(new Error('relay WebSocket closed before session.ready'));
    };
  });

  // ── step 4: RPC auth ──────────────────────────────────────────────────────
  try {
    const authResult = await rpc.call<{ status: string }>('auth', inputs.rpcCredentials);
    if (authResult.status !== 'success') {
      rpc.close();
      throw new Error(`relay auth failed: status=${authResult.status}`);
    }
  } catch (e) {
    rpc.close();
    throw e;
  }

  return {
    rpc,
    sessionId,
    streamUrl,
    close: () => rpc.close(),
  };
}
