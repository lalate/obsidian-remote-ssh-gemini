# Relay API scaffold (for mobile probe + next step)

`obsidian-remote-ssh` のモバイル relay probe が参照する
`https://.../healthz` を用意しつつ、次段階の relay API 呼び出しを試せる
最小スキャフォールドです。

このサービスは **relay本体の土台** です。
SSH/RPCブリッジ本体はまだ未実装ですが、API形と認証導線を先に固められます。

## できること

- `GET /healthz` で `200` + JSON を返す
- `GET /v1/capabilities` で利用可能機能を返す
- `POST /v1/connect` で relayサーバから target `host:port` への TCP到達プリチェック
- `GET /v1/stream/:sessionId` WebSocket JSON-RPC ストリーム（接続時 `session.ready` を送信）
- 任意の Bearer token 認証 (`RELAY_PROBE_TOKEN`)
- CORS ヘッダ付与 (`ALLOW_ORIGIN`)

## クイックスタート

```bash
cd deploy/relay-health
cp .env.example .env
# .env の RELAY_PROBE_TOKEN を必要なら設定

docker compose up -d --build
```

補足:

- `TLS_CERT_FILE` と `TLS_KEY_FILE` の両方を設定しない場合、サーバーは HTTP で起動します（ローカル検証向け）。
- 両方を設定した場合は HTTPS で起動します（モバイル本番検証向け）。

## iOS 実機向け TLS (Local CA)

自己署名 1 枚証明書より、**Local CA で署名したサーバー証明書**の方が
iOS で再現しやすく、証明書更新時の運用も安定します。

1. Local CA + サーバー証明書を生成

```bash
pwsh ./scripts/generate-local-ca-certs.ps1 \
  -ServerName 100.102.8.15 \
  -SubjectAltNames 100.102.8.15,localhost,127.0.0.1
```

2. relay を再起動

```bash
docker compose up -d --force-recreate relay-health
```

3. iOS に導入する CA 証明書を確認

- CA PEM: `deploy/relay-health/certs/ca.pem`
- iOS 用 DER: `deploy/relay-health/certs/relay-ios.cer`

必要なら DER を再出力:

```bash
pwsh ./scripts/export-ios-cert.ps1
```

4. iPhone 側で信頼設定

- `relay-ios.cer` を iPhone に転送してインストール
- Settings → General → About → Certificate Trust Settings
- `Obsidian Relay Local CA` を **Enable Full Trust**
- Obsidian を再起動

5. 接続先 URL

- Relay endpoint URL: `https://100.102.8.15:8080/v1/connect`
- 期待 stream URL: `wss://100.102.8.15:8080/v1/stream/...`

トラブル時の典型:

- `The certificate for this server is invalid` は、ほぼ CA 未信頼か旧証明書残留です。
- 旧プロファイルを削除し、最新 `relay-ios.cer` を入れ直してください。

起動後の確認:

```bash
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/v1/capabilities

# JSON-RPC (HTTP)
curl -i -X POST http://localhost:8080/v1/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"method":"server.info","params":{},"id":"2"}'

# E2E スモーク (PowerShell)
pwsh ./scripts/e2e-jsonrpc.ps1

# 自己署名証明書を生成（WSL OpenSSL）
pwsh ./scripts/generate-self-signed-certs.ps1

# WS JSON-RPC E2E (connect -> stream -> auth/server.info)
pwsh ./scripts/e2e-ws-jsonrpc.ps1

# 起動+E2E を一括実行 (PowerShell)
pwsh ./scripts/bootstrap-e2e.ps1

# Docker を WSL 側で使う場合
pwsh ./scripts/bootstrap-e2e.ps1 -DockerMode wsl

# 特定ディストリで実行したい場合
pwsh ./scripts/bootstrap-e2e.ps1 -DockerMode wsl -WslDistro Ubuntu

# Windows 側 Docker を強制したい場合
pwsh ./scripts/bootstrap-e2e.ps1 -DockerMode windows

# WSL で docker compose を動かす場合の例
# 1) WSL 側で compose up
# 2) Windows PowerShell 側で次を実行
#    pwsh ./scripts/e2e-jsonrpc.ps1

# HTTPS/WSS 環境で自己署名証明書を使う場合
pwsh ./scripts/e2e-jsonrpc.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify

# WSS でも同様
pwsh ./scripts/e2e-ws-jsonrpc.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify

# 起動+E2E 一括でも同様
pwsh ./scripts/bootstrap-e2e.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify

# connectプリチェック（200 + PRECHECK_OK または TARGET_UNREACHABLE）
curl -i -X POST http://localhost:8080/v1/connect \
  -H "Content-Type: application/json" \
  -d '{"requestId":"demo-1","host":"example.com","port":22,"username":"obsidian","remotePath":"/home/obsidian/vault"}'

# connect のレスポンスに含まれる streamUrl へ WebSocket 接続
# (例: websocat ws://localhost:8080/v1/stream/<sessionId>)
# 以後は JSON-RPC 2.0 フレームを送受信します

# 期待される最初のメッセージ例
# {"type":"session.ready","sessionId":"...","target":"host:22","message":"websocket json-rpc endpoint is ready"}

# token を設定した場合
curl -i -H "Authorization: Bearer <token>" http://localhost:8080/healthz
```

レスポンス例:

```json
{
  "ok": true,
  "service": "obsidian-remote-relay",
  "version": "0.0.0-dev",
  "timestamp": "2026-05-16T00:00:00.000000000Z"
}
```

## Obsidian モバイル設定

- Relay endpoint URL: `https://<your-host>/healthz`（または検証時は `http://<host>:8080/healthz`）
- Relay bearer token: `.env` で設定した token (任意)

## 注意

- 公開する場合は HTTPS 化してください（Cloudflare Tunnel, Caddy, Nginx など）。
- `POST /v1/connect` は現時点で TCP 到達プリチェックまでです。SSH 実接続は次フェーズです。
- `GET /v1/stream/:sessionId` は現時点で relay 内蔵 JSON-RPC スタブを返します（auth/server.info/fs.*）。

## JSON-RPC Endpoints

### /v1/jsonrpc
This endpoint supports the following JSON-RPC methods:

- `auth`: Authenticates a user with `username` and `password`.
- `server.info`: Returns server information such as name, version, and uptime.
- `fs.read`: Reads a file and returns its content.
- `fs.write`: Writes content to a file.

### Example Usage

#### Authentication
```json
{
  "jsonrpc": "2.0",
  "method": "auth",
  "params": {
    "username": "admin",
    "password": "password"
  },
  "id": "1"
}
```

#### Server Info
```json
{
  "jsonrpc": "2.0",
  "method": "server.info",
  "params": {},
  "id": "2"
}
```
