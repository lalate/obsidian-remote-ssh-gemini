import { RelayWsRpcClient } from './RelayWsRpcClient';

export interface DirectWsInputs {
  /** WebSocket URL of the Go daemon, e.g. "ws://100.x.y.z:9023/". */
  url: string;
  /** Token for JSON-RPC auth handshake. */
  token: string;
  /** WebSocket open + auth timeout in ms. Default 10 000. */
  timeoutMs?: number;
}

export interface DirectWsConnection {
  rpc: RelayWsRpcClient;
  close(): void;
}

/**
 * Establish a direct JSON-RPC 2.0 session over a plain WebSocket to the
 * Go daemon's --ws-addr endpoint. No relay server handshake — the
 * WebSocket talks directly to obsidian-remote-server over Tailscale (or
 * any other TCP-capable network).
 *
 * Steps:
 *   1. Open WebSocket to `url`
 *   2. Call `auth { token }` and verify `ok === true`
 *   3. Return `{ rpc, close }`
 *
 * Throws on any failure; caller catches and reports.
 */
export async function connectDirectWs(inputs: DirectWsInputs): Promise<DirectWsConnection> {
  const timeoutMs = inputs.timeoutMs ?? 10_000;

  // ── step 1: open WebSocket ────────────────────────────────────────────
  const rpc = await new Promise<RelayWsRpcClient>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;

    try {
      ws = new WebSocket(inputs.url);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const timer = activeWindow.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`direct WebSocket connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      activeWindow.clearTimeout(timer);
      resolve(new RelayWsRpcClient(ws));
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      activeWindow.clearTimeout(timer);
      reject(new Error('direct WebSocket error during connect'));
    };

    ws.onclose = (evt) => {
      if (settled) return;
      settled = true;
      activeWindow.clearTimeout(timer);
      reject(
        new Error(
          `direct WebSocket closed before open: code=${evt.code}${evt.reason ? ` reason=${evt.reason}` : ''}`,
        ),
      );
    };
  });

  // ── step 2: RPC auth ──────────────────────────────────────────────────
  try {
    const authResult = await rpc.call<{ ok: boolean }>('auth', { token: inputs.token });
    if (!authResult.ok) {
      rpc.close();
      throw new Error('direct WS auth failed: server rejected token');
    }
  } catch (e) {
    rpc.close();
    throw e;
  }

  return {
    rpc,
    close: () => rpc.close(),
  };
}
