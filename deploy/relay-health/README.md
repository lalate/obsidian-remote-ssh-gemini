# Relay API scaffold (for mobile probe + next step)

`obsidian-remote-ssh` のモバイル relay probe が参照する
`https://.../healthz` を用意しつつ、次段階の relay API 呼び出しを試せる
最小スキャフォールドです。

このサービスは **relay本体の土台** です。
SSH/RPCブリッジ本体はまだ未実装ですが、API形と認証導線を先に固められます。

## できること

- `GET /healthz` で `200` + JSON を返す
- `GET /v1/capabilities` で利用可能機能を返す
- `POST /v1/connect` のスタブ実装（入力検証 + `NOT_IMPLEMENTED` 応答）
- 任意の Bearer token 認証 (`RELAY_PROBE_TOKEN`)
- CORS ヘッダ付与 (`ALLOW_ORIGIN`)

## クイックスタート

```bash
cd deploy/relay-health
cp .env.example .env
# .env の RELAY_PROBE_TOKEN を必要なら設定

docker compose up -d --build
```

起動後の確認:

```bash
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/v1/capabilities

# connectスタブ（200 + NOT_IMPLEMENTED）
curl -i -X POST http://localhost:8080/v1/connect \
  -H "Content-Type: application/json" \
  -d '{"requestId":"demo-1","host":"example.com","port":22,"username":"obsidian","remotePath":"/home/obsidian/vault"}'

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
- `POST /v1/connect` は現在スタブ応答です。次フェーズでSSH/RPCブリッジ本体を実装します。
