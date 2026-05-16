# Relay health endpoint (for mobile probe)

`obsidian-remote-ssh` のモバイル relay probe が参照する
`https://.../healthz` を最短で用意するための最小サービスです。

このサービスは **疎通確認専用** です。SSHやRPCを中継しません。

## できること

- `GET /healthz` で `200` + JSON を返す
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
# token を設定した場合
curl -i -H "Authorization: Bearer <token>" http://localhost:8080/healthz
```

レスポンス例:

```json
{
  "ok": true,
  "service": "obsidian-remote-relay-health",
  "version": "0.0.0-dev",
  "timestamp": "2026-05-16T00:00:00.000000000Z"
}
```

## Obsidian モバイル設定

- Relay endpoint URL: `https://<your-host>/healthz`
- Relay bearer token: `.env` で設定した token (任意)

## 注意

- 公開する場合は HTTPS 化してください（Cloudflare Tunnel, Caddy, Nginx など）。
- これは relay本体ではなく、あくまで到達性ゲート用エンドポイントです。
