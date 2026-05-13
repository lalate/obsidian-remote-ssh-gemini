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

### 8. Phase8: プロトコル拡張と堅牢化 (exSpec.md 対応)
- [GEMINI.md](../GEMINI.md) を新設し、パス検証、JSONLログ、スロットリングの設計指針を明文化。
- [proto/README.md](../proto/README.md) に `persist`, `resumeFrom`, `seq`, `cli.output.batch` を追記。
- [server/internal/proto/types.go](../server/internal/proto/types.go) および [plugin/src/proto/types.ts](../plugin/src/proto/types.ts) の型を更新。
- [server/internal/handlers/cli_common.go](../server/internal/handlers/cli_common.go) の `validateWorkingDir` で `filepath.EvalSymlinks` による厳格なパス検証を実装。
- [server/internal/handlers/cli_streamer.go](../server/internal/handlers/cli_streamer.go) を新設し、JSONLログ保存、シーケンス番号管理、100ms/50件単位のスロットリングを実装。
- [server/internal/handlers/cli_spawn.go](../server/internal/handlers/cli_spawn.go) を更新し、`resumeFrom` による再接続・再送処理と、永続化時のバックグラウンド実行をサポート。
- コミット: `pending`

### 9. Phase9: クライアント/UI 対応 (exSpec.md 対応)
- [mobile/src/adapter/WsRemoteCliClient.ts](../mobile/src/adapter/WsRemoteCliClient.ts) を更新し、バッチ通知と永続化パラメータをサポート。
- [plugin/src/ui/CliTerminalView.ts](../plugin/src/ui/CliTerminalView.ts) を更新し、`cli.output.batch` のハンドリングとシーケンス番号の追跡を実装。
- [plugin/styles.css](../plugin/styles.css) に CLI ターミナル用のスタイルを追加。
- コミット: `pending`

### 10. Phase10: レビュー指摘の是正
- [server/internal/handlers/cli_spawn.go](../server/internal/handlers/cli_spawn.go) を更新し、`resumeFrom` 指定時に未知の `id` へフォールスルーして再実行しないように修正（unknown id は `InvalidParams` を返却）。
- [server/internal/handlers/cli_common.go](../server/internal/handlers/cli_common.go) の `validateWorkingDir` を更新し、`EvalSymlinks` + `filepath.Rel` で Vault 配下チェックを厳密化（prefix 判定を廃止）。
- [server/internal/handlers/cli_streamer.go](../server/internal/handlers/cli_streamer.go) の `Resume` を更新し、再送を 50 件ごとの `cli.output.batch` に分割してバースト送信を抑制。
- [next/proto/types.ts](../next/proto/types.ts) を更新し、`persist` / `resumeFrom` / `seq` / `CliOutputBatchParams` を同期。
- 検証: `server` で `go test ./...` 全件成功。
- コミット: `29ac9f6`

### 11. Phase11: 再接続リジュームのUI接続 + テスト拡充
- [plugin/src/ui/CliTerminalView.ts](../plugin/src/ui/CliTerminalView.ts) を更新し、接続断を検知した際に `resumeFrom` を使って `cli.spawn` を自動再試行する復旧フローを実装。
- [server/internal/proto/types.go](../server/internal/proto/types.go) の `CliSpawnParams.ResumeFrom` を `*int` に変更し、未指定と `0` を区別可能に修正。
- [server/internal/handlers/cli_spawn.go](../server/internal/handlers/cli_spawn.go) を更新し、`resumeFrom=0` を含む再開要求を正しく処理。
- [server/internal/handlers/cli_spawn_kill_test.go](../server/internal/handlers/cli_spawn_kill_test.go) に以下を追加:
  - unknown id の resume が `InvalidParams` を返すこと
  - `cli.output.batch` が送信されること
  - `resumeFrom=0` から再送できること
- [plugin/tests/ui/CliTerminalView.test.ts](../plugin/tests/ui/CliTerminalView.test.ts) を新設し、再接続後に `resumeFrom = lastSeq + 1` で `cli.spawn` が呼ばれることを検証。
- 検証:
  - `server`: `go test ./internal/handlers -run "TestCliSpawn_(ResumeUnknownID|EmitsBatchNotification|ResumeFromZeroReplaysPersistedOutput)" -v` 成功
  - `server`: `go test ./internal/server -run TestServer_CliSpawn_EmitsOutputAndDone -v` 成功
  - `plugin`: `npm test -- ui/CliTerminalView.test.ts` 成功
  - `plugin`: `npx tsc --noEmit` 成功
- コミット: `pending`

## あなたが決めること / やること
1. 再接続復旧のプロダクト方針を確定する
	- 自動再開をデフォルトONにするか、確認ダイアログを挟むか
2. ログ保持ポリシーを確定する
	- JSONLログの保持時間、最大サイズ、削除トリガー
3. `cli.output` と `cli.output.batch` の公開契約を確定する
	- 両方維持か、段階的移行か、クライアント側優先ルール
4. `mobile/dist` の運用方針を確定する
	- Git管理するか、CI/リリース時生成に寄せるか
5. 次PRの分割方針を確定する
	- 例: `server-resume`, `plugin-resume-ui`, `docs+tests` の3本
6. 受け入れ基準(DoD)を確定する
	- 切断→再接続→欠落なしで継続表示までをE2Eで確認する基準

## 補足
- 作業途中で Git 履歴の再構成が1回発生したが、最終的には現在の履歴を採用。
- 未追跡の `reference/` 配下ファイルは今回のログ保存先として使用。
