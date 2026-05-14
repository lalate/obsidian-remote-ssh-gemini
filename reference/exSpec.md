Gemini CLIとObsidian Remote SSHの統合を堅牢化するための**修正版技術仕様**を以下にまとめます。

この仕様は、セッション永続化のためのログ中継、パス検証によるセキュリティ強化、および通信負荷を抑えるスロットリングの実装に焦点を当てています。

### 1. JSON-RPC プロトコル定義の拡張

通信の再開（Sync back）を可能にするため、クライアント側から既読ポイントを指定できるフィールドを追加します [1, 2]。

```typescript
// next/proto/types.ts (TypeScript)

export interface CliSpawnParams {
  id: string;      // プロセス相関ID
  cmd: string;
  args: string[];
  cwd?: string;
  persist: boolean; // セッション永続化を有効にするか
  resumeFrom?: number; // 再接続時に読み出しを開始するJSONLの行番号（ポインタ）
}

export interface CliOutputParams {
  id: string;
  stream: 'stdout' | 'stderr';
  data: string;
  seq: number;     // 順序保証と再同期のためのシーケンス番号
}
```

### 2. Goデーモン：作業ディレクトリの厳格な検証

ディレクトリトラバーサルを防ぐため、実行前にパスの正規化と境界チェックを行います [3, 4]。

```go
// server/internal/handlers/cli_common.go (Go)

func validateWorkingDir(vaultRoot, requestedCwd string) (string, error) {
    // 1. パスの正規化
    absVaultRoot, _ := filepath.Abs(vaultRoot)
    targetDir := filepath.Join(absVaultRoot, requestedCwd)
    
    // 2. シンボリックリンクの解決
    resolvedPath, err := filepath.EvalSymlinks(targetDir)
    if err != nil {
        return "", err
    }

    // 3. Vaultルート配下にあるかチェック
    if !strings.HasPrefix(resolvedPath, absVaultRoot) {
        return "", fmt.Errorf("access denied: path outside vault root")
    }
    
    return resolvedPath, nil
}
```

### 3. セッション永続化：JSONLログによる中継層の実装

`cli.spawn` の出力を直接送るのではなく、一旦ファイルに記録し、そこからストリーミングする構造に変更します [5, 6]。

```go
// server/internal/handlers/cli_spawn.go (Go)

func handleSpawnWithPersistence(ctx context.Context, p proto.CliSpawnParams, session *Session) {
    logPath := filepath.Join(os.TempDir(), fmt.Sprintf("obsidian-cli-%s.jsonl", p.ID))
    logFile, _ := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
    defer logFile.Close()

    cmd := exec.CommandContext(ctx, p.Cmd, p.Args...)
    stdout, _ := cmd.StdoutPipe()
    
    // goroutine: 標準出力をJSONLに書き込む（永続化層）
    go func() {
        scanner := bufio.NewScanner(stdout)
        var seq int
        for scanner.Scan() {
            entry := proto.CliOutputParams{ID: p.ID, Data: scanner.Text(), Seq: seq}
            jsonLine, _ := json.Marshal(entry)
            logFile.Write(append(jsonLine, '\n'))
            seq++
        }
    }()
    
    // 別の処理で「ストリーミング層」がJSONLを読み取って通知を送信
}
```

### 4. 通信負荷軽減：出力通知のスロットリング

頻繁な出力をチャンク化し、モバイル端末の負荷を軽減します [7, 8]。

```go
// server/internal/handlers/cli_streamer.go (Go)

func startThrottledStreamer(session *Session, logPath string, lastSeq int) {
    ticker := time.NewTicker(100 * time.Millisecond) // 100msごとにバッチ送信
    defer ticker.Stop()

    var buffer []proto.CliOutputParams
    
    for {
        select {
        case <-ticker.C:
            if len(buffer) > 0 {
                // チャンク化したデータをまとめて送信
                session.SendNotification("cli.output.batch", buffer)
                buffer = nil
            }
        case line := <-logChannel: // JSONLからの読み取り
            buffer = append(buffer, line)
            // バッファが一定サイズを超えたら即時送信
            if len(buffer) > 50 {
                session.SendNotification("cli.output.batch", buffer)
                buffer = nil
            }
        }
    }
}
```

### 5. モバイル接続の堅牢化フロー

1.  **接続断**: iPhoneの通信が切れても、サーバー側のGoデーモンはJSONLへの書き込みを継続します [6]。
2.  **再接続**: Obsidianプラグインが再接続時に、最後に受け取った `seq` 番号を `resumeFrom` として送信します。
3.  **復旧**: サーバーはJSONLを指定行から読み直し、未送信分をバースト送信することで、ログの欠落を防ぎます [9]。

この修正により、Shadow Vaultが持つ「リモートとローカルの同期性」を維持しつつ、モバイル特有の不安定な環境においてもAIエージェントの実行を安定させることが可能になります。
