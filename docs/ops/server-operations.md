# WSS-Relay サーバ 操作手順書

> **対象**: Obsidian Remote SSH モバイルクライアント向け WSS-Relay サーバ
> **コンポーネント**: `obsidian-remote-relay-health` (Go), Docker Compose
> **最終更新**: 2026-07-03

---

## 目次

1. [概要](#1-概要)
2. [前提条件](#2-前提条件)
3. [クイックスタート](#3-クイックスタート)
4. [詳細設定](#4-詳細設定)
5. [TLS/HTTPS 設定](#5-tlshttps-設定)
6. [iOS 実機向け TLS (Local CA)](#6-ios-実機向け-tls-local-ca)
7. [API リファレンス](#7-api-リファレンス)
8. [運用と監視](#8-運用と監視)
9. [トラブルシューティング](#9-トラブルシューティング)
10. [セキュリティ](#10-セキュリティ)

---

## 1. 概要

WSS-Relay サーバ (`obsidian-remote-relay-health`) は、モバイル Obsidian クライアントとリモート SSH サーバの間を中継する WebSocket ベースのプロキシです。

### アーキテクチャ

```
[iOS Obsidian]                [WSS-Relay Server]                    [SSH Server]
      │                              │                                   │
      │  GET /healthz                 │  (生存確認)                        │
      ├─────────────────────────────► │                                   │
      │◄───────────────────────────── │                                   │
      │                              │                                   │
      │  POST /v1/connect             │  POST /v1/connect                  │
      │  {host,port,username,path}    │  → TCP 到達性プリチェック          │
      ├─────────────────────────────► ├── TCP connect ──────────────────► │
      │◄─ {streamUrl} ─────────────── │◄─ SYN/ACK ──────────────────────── │
      │                              │                                   │
      │  WebSocket /v1/stream/:id     │  (JSON-RPC 2.0 over WebSocket)    │
      ├─────────────────────────────► │  ── session.ready                 │
      │                              │  ── auth(username, password)       │
      │                              │  ── server.info                   │
      │                              │  ── fs.read / fs.write            │
      │◄───────────────────────────── │                                   │
```

### 提供機能

| エンドポイント | メソッド | 機能 |
|--------------|---------|------|
| `/healthz` | GET | 生存確認 (200 + JSON) |
| `/v1/capabilities` | GET | サーバ機能一覧 |
| `/v1/connect` | POST | 対象ホストへの TCP 到達性プリチェック |
| `/v1/stream/:sessionId` | GET (WS) | WebSocket JSON-RPC ストリーム |
| `/v1/jsonrpc` | POST | HTTP JSON-RPC (検証用) |

---

## 2. 前提条件

### サーバ要件

| 項目 | 要件 |
|------|------|
| OS | Linux (amd64 / arm64), macOS |
| Docker | Docker Engine 24+ + Docker Compose v2 |
| ディスク | 100MB 以上 (バイナリ + 設定) |
| メモリ | ~10MB RSS (アイドル時) |
| ネットワーク | ポート 8080 (HTTP) または 443 (HTTPS) の解放 |

### 必要なファイル

- `deploy/relay-health/Dockerfile`
- `deploy/relay-health/docker-compose.yml`
- `server/cmd/obsidian-remote-relay-health/main.go` (ソースコード)
- `server/go.mod`, `server/go.sum`

### ネットワーク要件

| 方向 | プロトコル | ポート | 用途 |
|------|-----------|--------|------|
| 受信 | TCP | 8080 / 443 | モバイルクライアントからの接続 |
| 送信 | TCP | 22 (任意) | SSH ホストへの到達性チェック |

---

## 3. クイックスタート

### 3.1 最小構成で起動

```bash
cd deploy/relay-health

# 設定ファイル作成
cp .env.example .env

# 起動
docker compose up -d --build

# 確認
curl -i http://localhost:8080/healthz
```

### 3.2 応答確認

```bash
# 生存確認
curl http://localhost:8080/healthz
# → {"ok":true,"service":"obsidian-remote-relay","version":"0.0.0-dev","timestamp":"..."}

# 機能一覧
curl http://localhost:8080/v1/capabilities
# → { capabilities: [...] }

# TCP 到達性プリチェック
curl -X POST http://localhost:8080/v1/connect \
  -H "Content-Type: application/json" \
  -d '{"requestId":"test-1","host":"example.com","port":22,"username":"obsidian","remotePath":"/home/obsidian/vault"}'
# → {"status":"PRECHECK_OK","streamUrl":"/v1/stream/xxx","sessionId":"xxx",...}
```

### 3.3 停止

```bash
cd deploy/relay-health
docker compose down

# イメージも削除する場合
docker compose down --rmi all
```

---

## 4. 詳細設定

### 4.1 環境変数 (.env)

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `RELAY_PROBE_TOKEN` | `""` (空=認証なし) | Bearer token 認証。設定すると全エンドポイントにトークン必須 |
| `RELAY_HEALTH_VERSION` | `0.0.0-dev` | ビルドバージョンタグ |
| `HOST_PORT` | `8080` | ホスト側に公開するポート番号 |
| `ALLOW_ORIGIN` | `*` | CORS 許可オリジン |
| `TLS_CERT_FILE` | `""` | TLS 証明書ファイルパス (HTTPS 時) |
| `TLS_KEY_FILE` | `""` | TLS 秘密鍵ファイルパス (HTTPS 時) |

### 4.2 docker-compose.yml リファレンス

```yaml
services:
  relay-health:
    build:
      context: ../..        # プロジェクトルートをビルドコンテキストに
      dockerfile: deploy/relay-health/Dockerfile
      args:
        VERSION: ${RELAY_HEALTH_VERSION:-0.0.0-dev}
    image: obsidian-remote-relay-health:latest
    container_name: obsidian-remote-relay-health
    restart: unless-stopped
    environment:
      RELAY_PROBE_TOKEN: ${RELAY_PROBE_TOKEN:-}
    command:
      - --listen=:8080       # リッスンアドレス
      - --path=/healthz      # ヘルスチェックパス
      - --allow-origin=${ALLOW_ORIGIN:-*}
    ports:
      - "${HOST_PORT:-8080}:8080"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
```

### 4.3 カスタム起動引数

`obsidian-remote-relay-health` バイナリに直接渡せるフラグ:

| フラグ | デフォルト | 説明 |
|-------|-----------|------|
| `--listen` | `:8080` | リッスンアドレス |
| `--path` | `/healthz` | ヘルスチェックパス |
| `--allow-origin` | `*` | CORS 許可オリジン |

---

## 5. TLS/HTTPS 設定

### 5.1 自己署名証明書 (テスト用)

```bash
cd deploy/relay-health

# 自己署名証明書を生成
pwsh ./scripts/generate-self-signed-certs.ps1

# 生成されるファイル:
#   certs/server.crt
#   certs/server.key
```

### 5.2 HTTPS で起動

`.env` に以下を追加:

```ini
TLS_CERT_FILE=/app/certs/server.crt
TLS_KEY_FILE=/app/certs/server.key
```

再起動:

```bash
docker compose up -d --force-recreate relay-health
```

### 5.3 リバースプロキシ (推奨)

本番環境では Nginx や Caddy による TLS 終端を推奨:

```nginx
# Nginx 設定例
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Cloudflare Tunnel の利用も可。

---

## 6. iOS 実機向け TLS (Local CA)

> 自己署名1枚証明書より Local CA 方式の方が iOS での信頼設定が安定します。

### 6.1 Local CA 証明書の生成

```bash
cd deploy/relay-health

pwsh ./scripts/generate-local-ca-certs.ps1 \
  -ServerName 100.102.8.15 \
  -SubjectAltNames 100.102.8.15,localhost,127.0.0.1
```

### 6.2 Relay の再起動

```bash
docker compose up -d --force-recreate relay-health
```

### 6.3 iOS への CA インストール

1. 証明書ファイルを確認:
   - `deploy/relay-health/certs/ca.pem` — CA 証明書 (PEM)
   - `deploy/relay-health/certs/relay-ios.cer` — iOS 用 DER

2. iPhone に `relay-ios.cer` を転送 (AirDrop / メール / ファイルアプリ)

3. インストール:
   - 設定 → 一般 → VPNとデバイス管理 → プロファイルをインストール

4. 信頼設定を有効化:
   - 設定 → 一般 → 情報 → 証明書信頼設定
   - `Obsidian Relay Local CA` を **フル信頼を有効にする** に ON

5. Obsidian を再起動

### 6.4 接続先 URL

| 項目 | 値 |
|------|-----|
| Relay endpoint | `https://100.102.8.15:8080/v1/connect` |
| Stream URL | `wss://100.102.8.15:8080/v1/stream/{sessionId}` |

### 6.5 トラブルシューティング

- **"The certificate for this server is invalid"** → CA 未信頼または旧証明書。旧プロファイルを削除して最新 `relay-ios.cer` を再インストール
- **DER の再出力が必要な場合**:
  ```bash
  pwsh ./scripts/export-ios-cert.ps1
  ```

---

## 7. API リファレンス

### 7.1 GET /healthz

生存確認エンドポイント。

**リクエスト**:
```bash
curl http://localhost:8080/healthz
```

**レスポンス** (200):
```json
{
  "ok": true,
  "service": "obsidian-remote-relay",
  "version": "0.0.0-dev",
  "timestamp": "2026-07-03T00:00:00.000000000Z"
}
```

### 7.2 GET /v1/capabilities

サーバが提供する機能一覧。

**リクエスト**:
```bash
curl http://localhost:8080/v1/capabilities
```

### 7.3 POST /v1/connect

対象 SSH ホストへの TCP 到達性をプリチェック。

**リクエスト**:
```bash
curl -X POST http://localhost:8080/v1/connect \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "session-001",
    "host": "192.168.1.100",
    "port": 22,
    "username": "obsidian",
    "remotePath": "/home/obsidian/vault"
  }'
```

**レスポンス** (200):
```json
{
  "status": "PRECHECK_OK",
  "streamUrl": "/v1/stream/abc123",
  "sessionId": "abc123",
  "target": "192.168.1.100:22",
  "message": "TCP reachability check passed"
}
```

**到達不可時**:
```json
{
  "status": "TARGET_UNREACHABLE",
  "sessionId": "",
  "target": "192.168.1.100:22",
  "message": "dial tcp 192.168.1.100:22: connect: connection refused"
}
```

### 7.4 GET /v1/stream/:sessionId (WebSocket)

WebSocket JSON-RPC 2.0 ストリーム。

**接続**:
```
ws://localhost:8080/v1/stream/abc123
```

**セッション確立メッセージ** (サーバ→クライアント):
```json
{
  "type": "session.ready",
  "sessionId": "abc123",
  "target": "192.168.1.100:22",
  "message": "websocket json-rpc endpoint is ready"
}
```

### 7.5 POST /v1/jsonrpc

HTTP 経由の JSON-RPC (検証用)。

#### auth

```bash
curl -X POST http://localhost:8080/v1/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"auth","params":{"username":"admin","password":"password"},"id":"1"}'
```

#### server.info

```bash
curl -X POST http://localhost:8080/v1/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"server.info","params":{},"id":"2"}'
```

#### fs.read / fs.write

ファイル読み書き (WebSocket ストリーム経由で利用可能)。

---

## 8. 運用と監視

### 8.1 起動確認

```bash
# Docker コンテナ状態
docker compose ps

# ログ監視
docker compose logs -f relay-health

# ヘルスチェック (コンテナ内蔵)
docker inspect --format='{{json .State.Health}}' obsidian-remote-relay-health
```

### 8.2 ヘルスチェック

Docker Compose の healthcheck が 10秒間隔で `/healthz` をポーリング:
- `interval: 10s`
- `timeout: 3s`
- `retries: 5` (50秒間連続失敗で unhealthy)

### 8.3 ログ

```bash
# リアルタイム
docker compose logs -f --tail=100 relay-health

# 特定期間
docker compose logs --since="2026-07-03T10:00:00" relay-health

# JSON 形式で出力
docker compose logs --no-color relay-health 2>&1 | jq -c '.'
```

### 8.4 E2E テスト

提供されている PowerShell スクリプト:

```bash
# HTTP JSON-RPC E2E
pwsh ./scripts/e2e-jsonrpc.ps1

# WebSocket JSON-RPC E2E
pwsh ./scripts/e2e-ws-jsonrpc.ps1

# 起動 + E2E 一括
pwsh ./scripts/bootstrap-e2e.ps1

# HTTPS/WSS + 自己署名証明書
pwsh ./scripts/e2e-jsonrpc.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify
pwsh ./scripts/e2e-ws-jsonrpc.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify
pwsh ./scripts/bootstrap-e2e.ps1 -BaseUrl https://localhost:8080 -SkipTlsVerify
```

### 8.5 定期的な運用タスク

| 頻度 | タスク | コマンド |
|------|--------|---------|
| 毎日 | 生存確認 | `curl -f http://localhost:8080/healthz` |
| 毎週 | ログローテーション確認 | `docker compose logs --tail=50 relay-health` |
| 毎月 | 証明書期限確認 | `openssl x509 -enddate -noout -in certs/server.crt` |
| 更新時 | イメージ再ビルド | `docker compose up -d --build relay-health` |

---

## 9. トラブルシューティング

### 9.1 コンテナが起動しない

```
症状: docker compose up で "failed to solve"
原因: ビルドコンテキストが正しくない
解決: deploy/relay-health/ ディレクトリで実行しているか確認
      docker-compose.yml の context: ../.. が正しいこと
```

### 9.2 /healthz が 401 を返す

```
症状: curl /healthz → 401 Unauthorized
原因: RELAY_PROBE_TOKEN が設定されているが Authorization ヘッダがない
解決: curl -H "Authorization: Bearer <token>" http://localhost:8080/healthz
```

### 9.3 POST /v1/connect で TARGET_UNREACHABLE

```
症状: connect が常に TARGET_UNREACHABLE
原因1: SSH ホスト名/ポートが間違っている
原因2: Relay サーバから SSH ホストに到達できない (ファイアウォール)
原因3: SSH ホストが稼働していない
解決:
  - Relay サーバ上で直接 ssh 接続テスト: ssh user@host -p port
  - ファイアウォールルールの確認
```

### 9.4 WebSocket 接続が確立できない

```
症状: WebSocket 接続後 session.ready が届かない
原因1: TLS 証明書エラー (iOS → Relay)
原因2: プロキシが WebSocket Upgrade を処理していない
解決:
  - iOS に CA 証明書がインストール済みか確認
  - Nginx リバースプロキシの場合 proxy_set_header Upgrade/Connection を確認
```

### 9.5 モバイルから "Relay endpoint unreachable"

```
症状: Obsidian Mobile の Relay Probe が FAIL
原因1: モバイル端末から Relay サーバへのネットワーク到達性がない
原因2: DNS 解決不能
原因3: ファイアウォールでブロック
解決:
  - モバイル Safari で https://relay.example.com:8080/healthz にアクセス確認
  - ping / traceroute で経路確認
```

---

## 10. セキュリティ

### 10.1 認証

- `RELAY_PROBE_TOKEN` を設定すると全エンドポイントが Bearer token 認証を要求
- トークンは `.env` ファイルで管理（`.env` は `.gitignore` 推奨）
- RPC 認証は `auth` JSON-RPC メソッドで username/password ベース

### 10.2 TLS

- 本番環境では **必ず HTTPS/WSS** で公開
- 推奨: Let's Encrypt (Certbot) または Cloudflare Tunnel
- 自己署名証明書はテスト/検証目的のみ

### 10.3 ネットワーク

| 対策 | 説明 |
|------|------|
| ファイアウォール | Relay サーバへのアクセスを必要な送信元IPに制限 |
| WAF | Cloudflare / mod_security 等の併用を推奨 |
| レート制限 | 必要に応じて Nginx 側で `limit_req` を設定 |

### 10.4 運用上の注意

- `.env` ファイルは機密情報を含むため適切に管理
- `RELAY_HEALTH_VERSION` はリリースタグと一致させる
- Cosign 署名検証 (`cosign verify-blob`) でリリースバイナリの真正性を確認
- **本リレーは開発段階 (scaffold) です。SSH/RPC ブリッジ本体は未実装です。**

---

## Appendix A: ディレクトリ構成

```
deploy/relay-health/
├── Dockerfile            # マルチステージビルド (golang:1.25-alpine → alpine:3.22)
├── docker-compose.yml    # Compose 設定 (healthcheck 付き)
├── README.md             # 既存ドキュメント (日本語)
├── .env.example          # 環境変数テンプレート
├── certs/                # TLS 証明書 (gitignore 推奨)
│   ├── ca.pem
│   ├── server.crt
│   ├── server.key
│   └── relay-ios.cer
└── scripts/              # 管理スクリプト
    ├── generate-local-ca-certs.ps1
    ├── generate-self-signed-certs.ps1
    ├── export-ios-cert.ps1
    ├── e2e-jsonrpc.ps1
    ├── e2e-ws-jsonrpc.ps1
    └── bootstrap-e2e.ps1
```

## Appendix B: 本番デプロイチェックリスト

- [ ] `RELAY_PROBE_TOKEN` を強力な値に設定
- [ ] TLS 証明書を設定 (Let's Encrypt / Cloudflare)
- [ ] `ALLOW_ORIGIN` を適切な値に制限
- [ ] ファイアウォールでアクセス元を制限
- [ ] Docker コンテナの再起動ポリシー確認 (`restart: unless-stopped`)
- [ ] ログローテーション設定
- [ ] バックアップ/復元手順の確認
- [ ] モバイル端末からの疎通確認

## Appendix C: 全APIエンドポイント対応表

| エンドポイント | メソッド | 認証 | プロトコル | 説明 |
|--------------|---------|------|-----------|------|
| `/healthz` | GET | 任意 | HTTP | 生存確認 |
| `/v1/capabilities` | GET | 任意 | HTTP | 機能一覧 |
| `/v1/connect` | POST | 任意 | HTTP | TCP 到達性プリチェック |
| `/v1/stream/:sessionId` | GET | 任意 | WebSocket | JSON-RPC ストリーム |
| `/v1/jsonrpc` | POST | ※ | HTTP | JSON-RPC (認証は params 内) |
