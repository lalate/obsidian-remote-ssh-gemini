---
title: Quickstart
lang: ja
tags: [getting-started, quickstart]
description: "5 分で動かす: Obsidian からリモート vault に SSH 接続、ノートが表示されることを確認、編集、ラウンドトリップが期待どおり機能することを検証する手順。"
---

# 5 分間 Quickstart

「プラグインインストール済み」から「リモート vault 上のファイルを編集している」までを 5 分で完走するページです。前提条件:

- obsidian-remote-ssh がインストール済み（[[ja/getting-started/install|インストール]] 参照）
- 公開鍵が `~/.ssh/authorized_keys` に登録された SSH 到達可能な Linux/macOS ホスト
- そのホスト上の vault 用ディレクトリ（空でも OK）

これらがまだ揃っていない場合は、[[en/server/docker|Docker quickstart server]]（英語）でサンドボックスをワンコマンド構築できます。

## 1. プラグイン設定を開く

**Settings** → **Community plugins** → **Obsidian Remote SSH** → ⚙️。

## 2. SSH プロファイルを追加

**Add profile** をクリックして以下を入力:

| 項目 | 例 | 備考 |
|---|---|---|
| Profile name | `My Pi` | 表示名のみ |
| Host | `192.168.1.50` または `pi.local` | `ssh` コマンドが受け付ける形式なら何でも |
| Port | `22` | デフォルト 22 |
| Username | `pi` | リモートユーザ名 |
| Authentication | `Private key` | [[en/configuration/profiles#authentication\|認証オプション]] (英語) |
| Private key path | `~/.ssh/id_ed25519` | ランタイムでチルダ展開されます |
| Remote vault path | `/home/pi/notes` または `~/notes` | リモート上に存在している必要あり |
| Mode | `Daemon (deploys helper on connect)` | 工場出荷時 `SFTP (direct)` から切り替え。低レイテンシ + push 通知が得られます。署名済みサーババイナリを自動デプロイ |

**Save** をクリック。

## 3. 接続

以下のいずれかで:

- **コマンドパレット**（⌘P / Ctrl+P）→ "Remote SSH: Connect" → プロファイルを選択
- リボンの **Remote SSH** アイコン → メニューからプロファイルを選択

裏で起こること:

1. プラグインが既存の鍵 / agent で SSH 接続を開く
2. プラグインが **デーモンバイナリをアップロード** (`~/.obsidian-remote/server`、約 5 MB)、SHA256 を検証
3. プラグインがリモートユーザ権限で **デーモンを起動**。デーモンは Unix socket を listen し、プラグインがそれを SSH トンネル経由で逆方向に転送
4. プラグインが **新しい "shadow vault" ウィンドウを開く** — リモートファイルをデーモン経由で読み書きする

初回接続は約 5–8 秒（バイナリアップロード）。2 回目以降は起動中のデーモンを再利用して約 1 秒で完了します。

## 4. 動作確認

新しいウィンドウで:

- ファイルを作成 → リモートで `ls` して存在を確認
- リモートでファイルを編集（`echo hello >> README.md`）→ Obsidian 上に約 500 ms 以内で反映されるのを確認

## 5. 切断

**コマンドパレット** → "Remote SSH: Disconnect" — または shadow vault ウィンドウを閉じるだけでも OK。デーモンは切断後も約 5 分間稼働を続ける（設定可能）ため、すぐ再接続すれば瞬時です。

## 動かなかった場合

- **認証失敗**: 秘密鍵パス / SSH agent を確認。プラグインは独自の認証情報ストアではなく既存の SSH 設定を使います
- **デーモンが起動しない**: 設定のデーモンパネル（⚙️ → Daemon）→ "View log"
- **ファイルが現れない**: リモート vault パスが存在することを確認。デーモンは自動作成しません（保護的設計 — [[ja/operations/troubleshooting|トラブルシューティング]] 参照）

続き: [[ja/getting-started/first-connect|初回接続 — 裏で何が起こっているのか]]。
