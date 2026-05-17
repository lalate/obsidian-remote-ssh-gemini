# CLI/Terminal View テストケース設計プレイブック

## 目的
- CLI 実行系 UI（旧: CliTerminalView、新: RemoteTerminalView 系）で、追加実装時にテスト漏れを防ぐ。
- 実装変更が入るたび、同じ観点で最小セットの回帰テストを増やせる状態にする。

## 対象の読み替え
- 旧ブランチ名/実装名:
  - `plugin/src/ui/CliTerminalView.ts`
- 現行の汎用化後:
  - `plugin/src/ui/RemoteTerminalView.ts`

> 命名が変わっても、テスト観点は「プロセス/シェルの開始・出力・終了・再接続・UI状態遷移」で共通。

## 基本方針
- 1テスト1責務: 成功系と失敗系を分ける。
- 外部境界はモック化:
  - RPC クライアント通知/close
  - xterm の write/writeln/dispose
  - ResizeObserver と activeWindow タイマー
- 文字列検証は「意味のある断片」で行う（完全一致を避ける）。
- タイマー系は fake timers で deterministic に検証する。

## 最小カバレッジセット（追加実装時の必須）

### 1. 初期化/終了
1. 未接続時 onOpen で disconnected 表示にフォールバックする。
2. 接続済み時 onOpen が Terminal 初期化・Addon 読み込み・open を実行する。
3. onClose で timer/observer/handler/terminal がすべて解放される。

### 2. 実行開始
1. 空入力は実行しない（spawn/call しない）。
2. 実行開始時に:
   - active id を採番する
   - 入力欄をクリアする
   - Run 無効 / Stop 有効に切り替える
3. spawn call が失敗した場合:
   - エラー表示
   - active 状態を解除
   - ボタン状態を元に戻す

### 3. ストリーム出力
1. stdout chunk がターミナルに追記される。
2. stderr chunk が警告色で追記される。
3. 改行変換（\n -> \r\n）が適用される。
4. 別 id の通知は無視される。
5. batch 通知で複数 chunk が順に処理される。

### 4. 完了イベント
1. 正常終了（exitCode=0）で Done 表示・running=false になる。
2. 異常終了（exitCode!=0）で終了コード表示になる。
3. done.error がある場合は Process error 表示を優先する。
4. 完了時にハンドラを dispose し、last payload をクリアする。

### 5. 停止操作
1. active id がある時だけ kill を送る。
2. kill 失敗時は例外を投げず warning ログのみ。

### 6. 再接続/再開（resume対応がある実装）
1. onClose 通知を受けたら resume 待機状態になり、再試行タイマーが入る。
2. resume 時に resumeFrom = max(0, lastSeq+1) が送られる。
3. 再開成功で waitingResume=false になり resumed メッセージを表示する。
4. unknown id エラー時は再開を打ち切り、running=false に戻す。
5. 接続未復帰（rpc closed/null）時は再試行を継続する。

### 7. リサイズ
1. ResizeObserver 発火で debounce 後に fit が呼ばれる。
2. fit/proposeDimensions 失敗時は throw せず debug ログに落とす。
3. shell open 中のみ resize を適用する（該当実装の場合）。

## 追加機能時のテスト追加ルール

実装に次の変更が入ったら、必ず対応ケースを1つ以上追加する:
- 新しい通知種別を追加した
  - 成功処理 + 想定外 payload 無視 の2ケース
- 新しい UI 状態（ボタン/入力可否）を追加した
  - 遷移前後の disabled/assert ケース
- 新しいリトライ条件を追加した
  - リトライ継続条件 + 打ち切り条件
- 新しいエラーメッセージ分岐を追加した
  - 分岐ごとの表示優先順位

## 推奨テストファイル構成
- 現行（next想定）:
  - `plugin/tests/ui/RemoteTerminalView.test.ts`
- 旧CLI実装ブランチ（feat/cli-core想定）:
  - `plugin/tests/ui/CliTerminalView.test.ts`

describe の推奨分割:
- `onOpen / onClose`
- `runPrompt`
- `output handling`
- `done / kill`
- `resume`
- `resize`

## テスト実装テンプレート（擬似）

```ts
it('spawn failure re-enables input row', async () => {
  // arrange: rpc.call('cli.spawn') を reject させる
  // act: runPrompt を実行
  // assert: run disabled=false, stop disabled=true, error表示あり
});
```

```ts
it('resume uses lastSeq + 1', async () => {
  // arrange: lastReceivedSeq=7 の状態を作る
  // act: reconnect -> tryResume
  // assert: cli.spawn の payload.resumeFrom === 8
});
```

## レビュー時チェックリスト
- 追加した分岐に対応するテストが同じPR内にある。
- 通知 id フィルタの negative case がある。
- dispose 漏れ（observer/timer/handler/terminal）がない。
- 例外を飲む場所でログ観測可能になっている。
- カバレッジの数値だけでなく、分岐網羅（特に resume/error）を確認した。

## 実行コマンド
- 単体テスト:
  - `npm run test`
- カバレッジ確認:
  - `npm run test:coverage`

必要に応じて、対象ファイルだけを `vitest run <path>` で実行し、開発ループを短くする。
