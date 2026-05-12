# 作業ログ: Gemini CLI Integration

## 概要
obsidian-remote-ssh に Gemini CLI 連携を追加する作業の記録。

## 時系列

### 1. Phase1: プロトコル定義
- [plugin/src/proto/types.ts](../plugin/src/proto/types.ts) に `cli.exec` / `cli.spawn` / `cli.kill` と通知型を追加。
- [next/proto/types.ts](../next/proto/types.ts) に同一の CLI プロトコル型を追加。
- [server/internal/proto/types.go](../server/internal/proto/types.go) に対応 struct を追加。
- ビルド検証: plugin / server ともに成功。
- コミット: `eaefeee`

### 2. Phase2: server 実装
- [server/internal/handlers/cli_common.go](../server/internal/handlers/cli_common.go) を追加し、whitelist と共通処理を実装。
- [server/internal/handlers/cli_exec.go](../server/internal/handlers/cli_exec.go) を追加し、同期実行を実装。
- [server/internal/handlers/cli_spawn.go](../server/internal/handlers/cli_spawn.go) を追加し、通知ストリーミングを実装。
- [server/internal/handlers/cli_kill.go](../server/internal/handlers/cli_kill.go) を追加し、プロセス終了を実装。
- [server/internal/handlers/cli_exec_test.go](../server/internal/handlers/cli_exec_test.go) を追加し、whitelist / success / non-zero exit を検証。
- ビルド・テスト検証: handlers / server ともに成功。
- コミット: `f1140b5`

### 3. Phase3: dispatcher 登録
- [server/cmd/obsidian-remote-server/main.go](../server/cmd/obsidian-remote-server/main.go) に `cli.exec` / `cli.spawn` / `cli.kill` を登録。
- server のテストとビルドを再確認。
- コミット: `5abdb45`

### 4. 統合テスト強化
- [server/internal/handlers/cli_spawn_kill_test.go](../server/internal/handlers/cli_spawn_kill_test.go) を追加し、`cli.spawn` の出力通知と `cli.kill` の unknown id を検証。
- [server/internal/server/server_test.go](../server/internal/server/server_test.go) に `cli.exec` / `cli.spawn` / `cli.kill` の統合確認を追加。
- `server.info` の capabilities 期待値を CLI 追加に合わせて更新。
- ビルド・テスト検証: handlers / server ともに成功。
- コミット: `f61ce67`

### 5. 仕様ドキュメント更新
- [proto/README.md](../proto/README.md) に CLI メソッド、通知、実行オプションを追記。
- コミット: `c916804`

### 6. mobile 側クライアント追加
- [mobile/src/transport/WsRpcClient.ts](../mobile/src/transport/WsRpcClient.ts) の MethodName に CLI を追加。
- [mobile/src/adapter/WsRemoteCliClient.ts](../mobile/src/adapter/WsRemoteCliClient.ts) を新設し、`exec` / `spawn` / `kill` と通知購読を公開。
- [mobile/src/index.ts](../mobile/src/index.ts) で再エクスポート。
- [mobile/tests/WsRemoteCliClient.test.ts](../mobile/tests/WsRemoteCliClient.test.ts) を追加。
- mobile のテストとビルドを確認。
- コミット: `97f4177`

### 7. proto/README.md 正式化 + plugin CLI ターミナル プロトタイプ
- [proto/README.md](../proto/README.md) の Shapes セクションに `CliExecParams` / `CliExecResult` / `CliSpawnParams` / `CliSpawnResult` / `CliKillParams` の TypeScript インターフェース定義（インラインコメント付き）を追加。
- Notifications セクションに `CliOutputParams` / `CliDoneParams` の正式な型定義とワイヤー例（JSON スニペット）を追加。
- `server/internal/proto/types.go` と `plugin/src/proto/types.ts` の型同期を確認（JSON フィールド名はすべて一致、変更不要）。
- [plugin/src/ui/CliTerminalView.ts](../plugin/src/ui/CliTerminalView.ts) を新設。xterm.js で出力をストリーミング表示し、`cli.spawn` → `cli.output` 通知 → `cli.done` の完全なフローを実装。Stop ボタンで `cli.kill` を呼び出す。
- [plugin/src/main.ts](../plugin/src/main.ts) に `registerView(VIEW_TYPE_CLI_TERMINAL, ...)` と `open-cli-terminal` コマンド（`rpcConnection` 接続時のみ有効）を追加。
- コミット: `42a1060`

## 補足
- 作業途中で Git 履歴の再構成が1回発生したが、最終的には現在の履歴を採用。
- 未追跡の `reference/` 配下ファイルは今回のログ保存先として使用。
