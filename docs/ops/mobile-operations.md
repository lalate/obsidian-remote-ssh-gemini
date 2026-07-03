# Obsidian Remote SSH — モバイル(iOS) 操作手順書

> **対象**: iOS Obsidian から WSS-Relay 経由でリモート SSH 保管庫に接続する環境
> **プラグイン**: `obsidian-remote-ssh` (fork版, mobile対応)
> **最終更新**: 2026-07-03

---

## 目次

1. [概要](#1-概要)
2. [前提条件](#2-前提条件)
3. [インストール](#3-インストール)
4. [設定手順](#4-設定手順)
5. [プロファイル設定リファレンス](#5-プロファイル設定リファレンス)
6. [接続手順](#6-接続手順)
7. [ChatUI の使い方](#7-chatui-の使い方)
8. [デバッグとトラブルシューティング](#8-デバッグとトラブルシューティング)
9. [コマンド一覧](#9-コマンド一覧)

---

## 1. 概要

モバイル版プラグインは、iOS Obsidian 上でリモート SSH サーバ上の保管庫(vault)にアクセスするための機能を提供します。

### アーキテクチャ

```
iOS Obsidian (MobilePlugin)
  │
  ├─ MobileConnectionManager ─── WSS-Relay ─── SSHサーバ ─── リモート保管庫
  │     (relay-rpc transport)      │              │
  │                                 │              └─ Go daemon (obsidian-remote-server)
  │                                 │                  Unix socket JSON-RPC
  │                                 │
  │                                 └─ Relay ヘルスチェック (/healthz)
  │                                    capabilities / connect / stream
  │
  ├─ AdapterManager.patch() ─── app.vault.adapter を差し替え
  ├─ BulkWalker + VaultModelBuilder ─── ファイルツリーを仮想保管庫に展開
  ├─ ChatUI ─── AI チャット (リモートファイルを読み書き)
  └─ FsChangeListener ─── リモート変更の監視
```

### デスクトップ版との違い

| 機能 | デスクトップ | モバイル |
|------|-------------|---------|
| ShadowVault (別ウィンドウ) | ✅ | ❌ (同一ウィンドウでアダプタ差し替え) |
| SSH 直接接続 (ssh2) | ✅ | ❌ (WSS-Relay のみ) |
| Go daemon 自動デプロイ | ✅ | ❌ (サーバ側で事前配置) |
| リソースブリッジ (画像表示) | ✅ | ❌ |
| StatusBar / Terminal | ✅ | ❌ |
| ChatUI | ✅ | ✅ |
| ファイル編集 (AdapterPatch) | ✅ | ✅ |

---

## 2. 前提条件

### iOS 側

- **iOS 18.0 以上** (Obsidian Mobile 1.8+)
- **Obsidian Mobile** (App Store 版)
- **ネットワーク**: WSS-Relay サーバへの HTTPS/WSS 接続が可能なこと
- **Buffer ポリフィル**: プラグイン内蔵 (iOS には Node.js Buffer が無いため、`MiniBuffer` が自動適用)

### サーバ側

- **WSS-Relay サーバ** が稼働していること (→ [サーバ操作手順書](./server-operations.md))
- **SSH サーバ** が `relay-rpc` トランスポート経由でアクセス可能であること
- **Go daemon** (`obsidian-remote-server`) が SSH サーバ上に配置済みであること

---

## 3. インストール

### 3.1 プラグインの配置

1. iOS Obsidian の設定 → Community plugins → フォルダアイコンをタップ
2. `.obsidian/plugins/` を開く
3. `remote-ssh/` フォルダを作成
4. 以下のファイルを配置:
   - `main.js` — ビルド済みプラグイン
   - `manifest.json` — メタデータ
   - `styles.css` — スタイルシート

### 3.2 プラグインの有効化

1. Obsidian 設定 → Community plugins を開く
2. 「Installed plugins」から **Remote SSH** を有効化
3. 設定画面に「Remote SSH」タブが追加されることを確認

---

## 4. 設定手順

### 4.1 初回セットアップ

1. 設定 → Remote SSH (Mobile) を開く
2. Relay Endpoint 欄に WSS-Relay サーバの URL を入力:
   ```
   https://your-relay-server.example.com:8080
   ```
3. 必要に応じて Bearer Token / RPC Username / RPC Password を入力

### 4.2 プロファイルの作成

1. 「Profile」セクションで **+Add** をタップ
2. 以下の項目を入力:

| 項目 | 値の例 | 説明 |
|------|--------|------|
| Name | `My Server` | 表示名 |
| Host | `192.168.1.100` | SSH サーバのホスト名/IP |
| Port | `22` | SSH ポート |
| Username | `obsidian` | SSH ユーザ名 |
| Auth Method | `password` | `password` / `privateKey` / `agent` |
| Password | `********` | パスワード (authMethod=password 時) |
| Private Key Path | `/path/to/id_rsa` | 鍵認証時 |
| Remote Path | `/home/obsidian/vault` | リモート保管庫の絶対パス |
| Transport | `relay-rpc` | **モバイルでは relay-rpc を推奨** |

> **Transport の選択**: モバイルでは `relay-rpc` を必ず選択してください。`sftp` / `rpc` は Node.js API が必要であり、iOS では利用できない可能性があります。

3. 保存 (Save) をタップ

### 4.3 プロファイルの検証

作成したプロファイルを選択し、**Validate** ボタンをタップ:

- 必須フィールドの充足チェック
- Relay endpoint の URL 形式チェック
- エラーがあれば詳細表示

---

## 5. プロファイル設定リファレンス

### MobileProfile 型定義

```typescript
type MobileProfile = {
  id: string;                    // UUID (自動生成)
  name: string;                  // 表示名
  host: string;                  // SSH ホスト
  port: number;                  // SSH ポート (デフォルト 22)
  username: string;              // SSH ユーザ名
  authMethod: 'password' | 'privateKey' | 'agent';
  passwordRef?: string;          // パスワード
  privateKeyPath?: string;       // 秘密鍵パス
  passphraseRef?: string;        // パスフレーズ
  agentSocket?: string;          // SSH エージェントソケット
  hostKeyFingerprint?: string;   // ホスト鍵フィンガープリント
  remotePath: string;            // リモート保管庫パス (絶対パス推奨)
  connectTimeoutMs: number;      // タイムアウト (デフォルト 15000)
  keepaliveIntervalMs: number;   // キープアライブ間隔 (デフォルト 10000)
  keepaliveCountMax: number;     // キープアライブ最大試行 (デフォルト 3)
  transport?: string;            // 'sftp' | 'rpc' | 'relay-rpc'
  relayBaseUrl?: string;         // プロファイル固有の Relay URL
  relayAuthToken?: string;       // Relay Bearer Token
  relayRpcUsername?: string;     // Relay RPC 認証ユーザ名
  relayRpcPassword?: string;     // Relay RPC 認証パスワード
  jumpHost?: {                   // 踏み台ホスト設定 (任意)
    host: string;
    port: number;
    username: string;
    authMethod: string;
    privateKeyPath?: string;
    passwordRef?: string;
  };
};
```

### Relay 設定

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| Relay Endpoint | (必須) | WSS-Relay サーバのベース URL |
| Bearer Token | なし (任意) | Relay 認証トークン |
| RPC Username | `admin` | Relay RPC 認証ユーザ |
| RPC Password | `password` | Relay RPC 認証パスワード |

---

## 6. 接続手順

### 6.1 通常接続

1. 設定画面でプロファイルを選択
2. **Connect** ボタンをタップ (またはコマンドパレットから `Mobile: Connect`)
3. 以下のフローが自動実行:
   ```
   1. Relay Probe → endpoint の /healthz に GET リクエスト
   2. Relay Connect Test → POST /v1/connect で TCP 到達性確認
   3. Relay Stream Test → WebSocket /v1/stream/:sessionId 確立
   4. Relay RPC Test → JSON-RPC auth → server.info
   5. Relay コネクション確立 → MobileConnectionManager に保存
   6. AdapterManager.patch() → app.vault.adapter 差し替え
   7. BulkWalker でリモートファイルツリー取得
   8. VaultModelBuilder.build() → 保管庫にファイル投入
   ```
4. 接続完了後、ファイルエクスプローラにリモート保管庫の内容が表示される

### 6.2 切断

- **Disconnect** ボタン (またはコマンド `Mobile: Disconnect`)
- アダプタのパッチが解除され、ローカル保管庫に戻る

### 6.3 接続状態の確認

- **Status** ボタン (またはコマンド `Mobile: Status`) で現在の状態を表示
- ステータス: `IDLE` / `CONNECTING` / `SYNCING` / `ACTIVE` / `DISCONNECTING` / `ERROR`

---

## 7. ChatUI の使い方

ChatUI はリモート保管庫内のファイルに対して AI チャットを行う機能です。

### 7.1 チャットファイルの作成

保管庫内に以下の形式の Markdown ファイルを作成:

```markdown
## User
このファイルの内容を要約して

## Assistant
ここに AI の応答が追記されます
```

### 7.2 チャット操作

1. チャットファイルを開く
2. コマンドパレットから `Chat: Send last section to LLM` を実行
3. `## User` セクションの内容が LLM に送信される
4. AI の応答が `## Assistant` セクションとして追記される
5. リモートファイルに直接書き込まれる

### 7.3 動作の仕組み

```
ChatParser がファイルを解析
  → 最後の ## User セクションを抽出
  → ChatController が LLM API に送信
  → ストリーミング応答を ## Assistant として追記
  → RpcRemoteFsClient.writeBinary() でリモートに保存
```

---

## 8. デバッグとトラブルシューティング

### 8.1 ログの確認

1. **Preview Logs** — 設定画面の下部にリアルタイムログが表示
2. **Copy Logs** ボタンでクリップボードにログをコピー
3. ログレベル: `debug` / `info` / `warn` / `error`

### 8.2 動作検証コマンド

| コマンド | 機能 |
|---------|------|
| `Mobile: Validate Profiles` | 全プロファイルの設定値をチェック |
| `Mobile: Run Connection Probe` | 指定ホスト:ポートへの TCP 到達性確認 |
| `Mobile: Copy Probe Report` | プローブ結果をクリップボードにコピー |
| `Mobile: Copy Verification Report` | 検証結果レポートをコピー |
| `Mobile: Copy Preview Logs` | プレビューログをコピー |

### 8.3 典型的なトラブル

#### 接続に失敗する

```
症状: "Failed to establish relay connection"
原因1: Relay endpoint が間違っている → URL を確認
原因2: Relay サーバが停止している → サーバ側で docker compose ps
原因3: Bearer token が不一致 → .env と設定を確認
原因4: TLS 証明書エラー → iOS に CA 証明書がインストール済みか確認
```

#### ファイルが表示されない

```
症状: 接続成功したがファイルエクスプローラが空
原因1: remotePath が間違っている → 絶対パスで指定
原因2: BulkWalker が失敗 → ログで "BulkWalker" エラーを確認
原因3: Go daemon が起動していない → サーバ側で確認
```

#### ChatUI が応答しない

```
症状: Send section しても何も起こらない
原因1: 接続が切れている → Status で確認
原因2: ファイル形式が不正 → ## User / ## Assistant セクションがあるか確認
原因3: LLM API キーが設定されていない
```

#### ログが多すぎる

- 設定 → Debug Logging をオフにする
- Max Log Lines の値を減らす (デフォルト 500)

### 8.4 レポート形式

各テスト結果は以下の形式でコピーされます:

```
Mobile Relay Probe Report
===========================
Timestamp: 2026-07-03T10:00:00.000Z
Endpoint: https://relay.example.com:8080
Status: OK / FAIL
HTTP Status: 200
Latency: 42ms
Session ID: abc123
Stream URL: wss://relay.example.com:8080/v1/stream/abc123
Detail: ...
Note: ...
```

---

## 9. コマンド一覧

コマンドパレット (Cmd+P / Ctrl+P) から実行可能:

| コマンド ID | 表示名 | 機能 |
|------------|--------|------|
| `mobile-connect` | Mobile: Connect | 選択プロファイルに接続 |
| `mobile-disconnect` | Mobile: Disconnect | 切断 |
| `mobile-status` | Mobile: Status | 接続状態を表示 |
| `mobile-validate-profiles` | Mobile: Validate Profiles | プロファイル設定検証 |
| `mobile-run-connection-probe` | Mobile: Run Connection Probe | 接続プローブ実行 |
| `mobile-run-connection-probe-report` | Mobile: Copy Probe Report | プローブ結果コピー |
| `mobile-copy-verification-report` | Mobile: Copy Verification Report | 検証レポートコピー |
| `mobile-copy-preview-logs` | Mobile: Copy Preview Logs | ログコピー |
| `mobile-run-relay-probe` | Mobile: Run Relay Probe | Relay エンドポイント健全性確認 |
| `mobile-run-relay-connect-test` | Mobile: Run Relay Connect Test | Relay 接続テスト |
| `mobile-run-relay-stream-test` | Mobile: Run Relay Stream Test | WebSocket ストリームテスト |
| `mobile-run-relay-rpc-test` | Mobile: Run Relay RPC Test | RPC 機能テスト |

---

## Appendix A: 接続フロー図

```
[iOS Obsidian]                    [WSS-Relay Server]              [SSH Server]
      │                                  │                            │
      ├─ GET /healthz ──────────────────► │                            │
      │◄─ 200 {ok:true} ───────────────── │                            │
      │                                  │                            │
      ├─ POST /v1/connect ──────────────► │                            │
      │  {host, port, username}          ├─ TCP connect ─────────────► │
      │                                  │◄─ SYN/ACK ────────────────── │
      │◄─ {status:"PRECHECK_OK",         │                            │
      │    streamUrl:"/v1/stream/X"} ──── │                            │
      │                                  │                            │
      ├─ WebSocket /v1/stream/X ────────► │                            │
      │◄─ {type:"session.ready"} ──────── │                            │
      │                                  │                            │
      ├─ JSON-RPC: auth ────────────────► │                            │
      │◄─ {result:{ok:true}} ──────────── │                            │
      │                                  │                            │
      ├─ JSON-RPC: server.info ─────────► │                            │
      │◄─ {result:{version:"1.0.0"}} ──── │                            │
      │                                  │                            │
      │  === 接続確立 ===                  │                            │
      │                                  │                            │
      ├─ fs.walk("/") ──────────────────► │ ─── SSH tunnel ──────────► │
      │◄─ ファイルツリー ───────────────── │◄─────────────────────────── │
      │                                  │                            │
      ├─ VaultModelBuilder.build()       │                            │
      ├─ AdapterManager.patch()          │                            │
      │                                  │                            │
      │  === 編集可能 ===                  │                            │
      │                                  │                            │
      ├─ fs.write("note.md") ───────────► │ ─── SSH tunnel ──────────► │
      │◄─ {ok:true} ──────────────────── │◄─────────────────────────── │
```

## Appendix B: 設定画面 UI 項目

```
┌──────────────────────────────────────┐
│  Remote SSH (Mobile) Settings        │
│                                      │
│  ── Relay Configuration ──           │
│  Endpoint: [https://...:8080     ]   │
│  Bearer Token: [****************  ]   │
│  RPC Username: [admin           ]   │
│  RPC Password: [****************  ]   │
│                                      │
│  ── Profiles ──                      │
│  [+ Add]                             │
│                                      │
│  ▼ My Server                         │
│    Host: 192.168.1.100:22            │
│    User: obsidian                    │
│    Path: /home/obsidian/vault        │
│    Transport: relay-rpc              │
│    [Connect] [Validate] [Delete]     │
│                                      │
│  ── Preview Logs ──                  │
│  [..................................................] │
│  [Copy Logs]                         │
└──────────────────────────────────────┘
```
