---
title: トラブルシューティング
lang: ja
tags: [operations]
description: "obsidian-remote-ssh の典型的な問題の診断: 接続失敗、ホストキー不一致、デーモンデプロイエラー、競合 surface、同期遅延 — 症状、原因、対処。"
---

# トラブルシューティング

ほとんどの不具合は少数のパターンに収まります。このページは症状 → 原因 → 対処の対応表です。

## 接続が即座に失敗する

| 症状 | 原因 | 対処 |
|---|---|---|
| `Permission denied (publickey)` | SSH 認証が間違っている | リモートの `~/.ssh/authorized_keys` に鍵が登録されているか確認。先にターミナルから `ssh -i <key> user@host` で疎通確認 |
| `Host key verification failed` | プラグインの known-host ストアが拒否した | 設定 → trust ダイアログを開く。known host が変わった場合は [[en/security/host-keys\|Host-key trust]]（英語） |
| `Connection refused` | sshd が listen していない | ポートを確認。`nc -zv <host> <port>` で到達性確認 |
| `Connection timeout` | ネットワーク / ファイアウォール | 同経路に `ping` で疎通する? sshd ポートはファイアウォール解放されている? |
| `Daemon failed to start`（バイナリアップロード後） | デーモンが起動時にクラッシュ | 下の **デーモンが起動しない** を参照 |

## デーモンが起動しない

デーモンログを確認: **Settings** → **Daemon** → "View log"、または直接:
```bash
ssh user@host 'cat ~/.obsidian-remote/server.log'
```

よくあるパターン:

- socket オープン時の `permission denied` → `~/.obsidian-remote/` のオーナーシップを確認。`mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote` で再作成
- socket での `bind: address already in use` → 既に別のデーモンが動いている。`pkill -f obsidian-remote-server` で停止するか、profile で別の socket パスを指定
- `vault root does not exist` → profile の "Remote vault path" を実在するパスに設定。デーモンはディレクトリを自動作成しません
- `inotify_add_watch: too many open files` → `fs.inotify.max_user_watches` を上げる（[[en/api/watch|fs.watch caveats]] (英語) 参照）

## ファイルが同期されない

| 症状 | 原因 | 対処 |
|---|---|---|
| ローカル編集がリモートに反映されない | プラグインの書き込みが silent fail — developer console (`Cmd+Opt+I` / `Ctrl+Shift+I`) で `[remote-ssh]` エラーを確認 | リモート vault ディレクトリのパーミッション問題が多い |
| リモート編集がローカルに反映されない | `fs.watch` 購読が無効、または `inotify` watch limit に到達 | Settings → Daemon → Restart。`fs.inotify.max_user_watches` を上げる（[[en/api/watch\|fs.watch caveats]] (英語) 参照） |
| 特定ファイルが常に conflict になる | 双方向の編集衝突 | [[en/user-guide/conflicts\|Conflict handling]]（英語） |
| 大きいバイナリファイルがいつまでも開かない | プラグインはオンデマンドダウンロード — 初回オープンが遅い | 仕様。再オープン以降はローカルキャッシュが効きます |

## 体感が遅い

頻度順の犯人候補:

1. **SSH レイテンシが高い** — `ping <host>` で RTT を見積もる。RPC ごとの RTT は ping の約 2 倍。50 ms を超えるとタイピングがもたつき始める
2. **inotify limit** — デーモンが全ディレクトリを購読できていない。症状: リモート編集がフォーカス切替時まで反映遅延。対処は [[en/api/watch|fs.watch]]（英語）
3. **vault が遅いディスク上**（Pi の SD カード）— `fs.walk` cold-cache が一番遅い op。USB SSD への移行を推奨
4. **新しいホストへの初回接続** — バイナリアップロード（約 5 MB）は 1 回だけ。次回以降はスキップ

詳細な perf debug: [[en/configuration/advanced|Debug logging]]（英語）を有効化し、`<plugin>/console.log`（ローテーションあり: `console.log` + `.1` + `.2` + `.3`）で op ごとのタイミングを確認。

ネットワーク / ディスク / inotify / デーモン側キャッシュを通したフルチューニング手順は [[en/operations/performance-tuning|Performance tuning]]（英語）にあります。

## ヘルプを求めるとき

issue を立てるときは以下を貼り付けてください:

1. **プラグインバージョン**: Settings → Community plugins → "Remote SSH" 欄
2. **デーモンバージョン**: Settings → Daemon panel → ステータスバッジ
3. **プラグインログ**（`<vault>/.obsidian/plugins/remote-ssh/console.log` の最終 50 行）
4. **デーモンログ**（`~/.obsidian-remote/server.log` の最終 50 行）
5. **ローカル OS** + **リモート OS / arch**（リモートで `uname -a`）
6. **期待した挙動 vs 実際の挙動**

issue 投稿先: [github.com/sotashimozono/obsidian-remote-ssh/issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues)

次: [[en/operations/logs|Logs & telemetry]]（英語）。
