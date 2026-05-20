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
- `GET /v1/stream/:sessionId` WebSocket ストリーム（接続時 `session.ready` を送信）
  - `RELAY_RPC_MODE=stub`（既定）: 最小 JSON-RPC スタブ（auth/server.info/fs.write/fs.read）
  - `RELAY_RPC_MODE=framed`: WebSocket JSON-RPC を target 側の framed JSON-RPC（Content-Length 形式）へ中継
- 任意の Bearer token 認証 (`RELAY_PROBE_TOKEN`)
- CORS ヘッダ付与 (`ALLOW_ORIGIN`)

## クイックスタート

```bash
cd deploy/relay-health
cp .env.example .env
# .env の RELAY_PROBE_TOKEN を必要なら設定

docker compose up -d --build
```

## HTTPS クイックスタート（Caddy TLS 終端）

`certs/cert.pem` と `certs/key.pem` がある状態で、TLS終端を同時起動します。

```bash
cd deploy/relay-health
cp .env.example .env

# certs/cert.pem と certs/key.pem が未作成なら先に生成
pwsh ./scripts/generate-self-signed-certs.ps1 -IpSans 192.168.1.188,100.102.8.15 -DnsSans localhost

docker compose --profile tls up -d --build
```

確認:

```bash
curl -k -i https://localhost:8443/healthz
curl -k -i https://localhost:8443/v1/capabilities
```

## 証明書つきセットアップ（Windows + WSL）

モバイル実機で HTTPS を使う場合は、証明書の SAN に実際の接続先 IP/DNS を含める必要があります。

```powershell
cd deploy/relay-health

# 例: 自宅LAN IP と Tailscale IP を SAN に含める
pwsh ./scripts/generate-self-signed-certs.ps1 \
  -IpSans 192.168.1.188,172.21.223.29,100.102.8.15 \
  -DnsSans localhost
```

上記スクリプトは `deploy/relay-health/certs/` に次を生成します。

- `relay.crt` / `relay.key`（サーバ証明書と秘密鍵）
- `cert.pem` / `key.pem`（TLS終端でよく使う名前の互換コピー）
- `relay-ios.cer`（iOS配布用CA証明書）

生成後は、TLS終端しているプロセス（nginx/caddy/traefik/relayコンテナなど）を再起動してください。
再起動しないと古い証明書を掴んだままになります。

## 実運用メモ（HTTPS）

- この `docker-compose.yml` 自体は relay-health を平文HTTPで起動します。
- `docker compose --profile tls up` を使うと、同梱の Caddy が `:8443` で TLS 終端します。
- HTTPS は前段のTLS終端（reverse proxy）で有効化してください。
- TLS終端側で `cert.pem` / `key.pem`（または `relay.crt` / `relay.key`）を参照してください。

## Windows + WSL でのLANテスト注意

Windowsホスト上のWSLサービスを同一LAN内の別端末（iPhoneなど）から叩く場合、
Windows Defender Firewall の受信許可が必要になることがあります。

```powershell
netsh advfirewall firewall add rule name="WSL HTTP 8080" dir=in action=allow protocol=TCP localport=8080
```

- Tailscale経由の接続では不要な場合があります。
- テスト後に閉じたい場合は次で削除できます。

```powershell
netsh advfirewall firewall delete rule name="WSL HTTP 8080"
```

起動後の確認:

```bash
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/v1/capabilities

# connectプリチェック（200 + PRECHECK_OK または TARGET_UNREACHABLE）
curl -i -X POST http://localhost:8080/v1/connect \
  -H "Content-Type: application/json" \
  -d '{"requestId":"demo-1","host":"example.com","port":22,"username":"obsidian","remotePath":"/home/obsidian/vault"}'

# connect のレスポンスに含まれる streamUrl へ WebSocket 接続
# (例: websocat ws://localhost:8080/v1/stream/<sessionId>)
# 以後はバイナリフレームがそのまま target host:port へ流れます

# 期待される最初のメッセージ例
# {"type":"session.ready","sessionId":"...","target":"host:22","message":"websocket stream scaffold established"}

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

実機確認の例:

```text
Relay endpoint URL (HTTP): http://192.168.1.188:8080/healthz
Relay endpoint URL (HTTPS/Caddy): https://192.168.1.188:8443/healthz
```

## 注意

- 公開する場合は HTTPS 化してください（Cloudflare Tunnel, Caddy, Nginx など）。
- `POST /v1/connect` は target への TCP 到達プリチェックを行います。
- `RELAY_RPC_MODE=framed` は、target が **framed JSON-RPC（Content-Length 形式）** を話す前提です。
- target が `openssh-server`（SSH 生プロトコル）だけの場合、`RELAY_RPC_MODE=framed` では JSON-RPC は成立しません。
  SSH 経由で `obsidian-remote-server` の Unix socket へ中継するブリッジは別実装が必要です。
