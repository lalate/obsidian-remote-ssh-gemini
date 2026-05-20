# モバイル relay-rpc 実機チェックシート（リモートサーバ接続）

目的: relay 疎通確認だけでなく、既存機能（read/write など）が実運用レベルで動くかを短時間で確認する。

所要時間: 10-15分

## 0. 事前準備

- iPhone が対象ネットワーク（Wi-Fi または Tailscale）に接続済み。
- relay endpoint が到達可能（例: `https://<host>:8080/healthz`）。
- 証明書の SAN に接続先 IP/DNS が含まれている。
- iOS 側で CA 証明書を信頼済み（自己署名の場合）。
- モバイル設定で対象 profile の transport が `relay-rpc`。

## 1. Relay レイヤー確認

1. Mobile relay probe を実行する。
- 期待値: `Status: PASS`, `HTTP status: 200`

2. Mobile relay connect test を実行する。
- 期待値: `Status: PASS`, `Relay code: PRECHECK_OK`
- 期待値: `Session ID` と `Stream URL` が返る

3. Mobile relay stream test を実行する。
- 期待値: `Status: PASS`
- 期待値: `session.ready` 受信

## 2. Mainline（既存機能）確認

1. Mobile SSH connect test（mainline）を実行する。
- 期待値: `Status: PASS`
- 期待値: `auth/server.info/fs.write/fs.read ok`
- 期待値: `attempts=1`（最大でも `<=3`）

2. 同テストを 3 回連続で実行する。
- 期待値: すべて `PASS`
- 記録: 各回 latency（参考）

## 3. 接続切替確認（任意だが推奨）

1. Wi-Fi OFF -> ON（または経路切替）後に mainline を再実行する。
- 期待値: `PASS`
- 期待値: retries が増えても `<=3` で収束

## 4. 失敗時の切り分け

- relay probe 失敗:
  - endpoint URL, firewall, cert trust/SAN を確認

- relay connect 失敗:
  - `Relay code` を確認
  - `TARGET_UNREACHABLE` の場合は target host:port 到達性を確認

- stream 失敗:
  - `session.ready` まで来るか確認
  - WebSocket URL (`wss://.../v1/stream/...`) の到達性を確認

- mainline 失敗:
  - `auth/server.info/fs.write/fs.read` のどこで失敗したか確認
  - relay 層 PASS / mainline NG なら RPC 処理側を重点調査

## 5. 合格基準（DoD 連動）

- relay probe/connect/stream がすべて PASS
- mainline connect test が PASS（最低 1 回）
- 推奨: mainline 3 連続 PASS
- 推奨: 異なるネットワーク経路で 1 回以上 PASS

## 6. 記録テンプレ

```text
Date:
Plugin version:
Endpoint:
Network:

Relay probe:
Relay connect:
Relay stream:
Mainline test #1:
Mainline test #2:
Mainline test #3:

Notes:
- latency:
- retry attempts:
- error code/detail (if any):
```
