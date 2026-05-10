---
title: Raspberry Pi vault from scratch
lang: ja
tags: [cookbook, how-to, raspberry-pi]
description: "Raspberry Pi をホーム vault サーバとしてゼロからセットアップ: OS インストール、SSH 鍵、vault ディレクトリ、ネットワークアクセス、対応するプラグインプロファイル。"
schema: Article
---

# Raspberry Pi vault — ゼロからのセットアップ

ゴール: 自宅ネットワーク上の Pi に Obsidian vault をホストし、ノート PC からこのプラグイン経由で編集する。Pi OS インストール込みで約 30 分。

## ハードウェア + OS

- Pi 4 / Pi 5（RAM 4 GB で十分）。小規模 vault なら Pi Zero 2 W も動作
- 32 GB+ microSD、または（推奨）USB 接続 SSD
- Raspberry Pi OS (Bookworm) または Ubuntu Server 22.04+ for arm64

[Raspberry Pi Imager](https://www.raspberrypi.com/software/) で焼く。歯車アイコンから:

- ホスト名: `obsidian-vault.local`（任意。覚えやすい名前を）
- SSH 有効化: Yes、既存の公開鍵で公開鍵認証
- Wi-Fi 認証情報（または有線接続）

Pi を起動し、約 60 秒待機。

## ノート PC からの初回接続

まず通常のターミナルから SSH が通ることを確認:
```bash
ssh pi@obsidian-vault.local
```

これが通れば Pi 側の準備は完了 — リモートにはこれ以上何も必要ありません。vault 用ディレクトリを作成:
```bash
ssh pi@obsidian-vault.local 'mkdir -p ~/notes'
```

## プラグインに profile を追加

**Settings** → **Remote SSH** → **Add profile**:

| 項目 | 値 |
|---|---|
| Profile name | `Pi vault` |
| Host | `obsidian-vault.local`（または Pi の IP） |
| Port | `22` |
| Username | `pi` |
| Authentication | `SSH agent`（推奨） または秘密鍵パス |
| Remote vault path | `/home/pi/notes`（または `~/notes`） |
| Mode | `Daemon (deploys helper on connect)`（SFTP デフォルトより低レイテンシ） |

**Save** クリック後、コマンドパレットから接続: "Remote SSH: Connect" → `Pi vault` を選択。

プラグインがデーモンバイナリ（約 5 MB）をアップロードして起動し、shadow vault ウィンドウを開きます。初回接続は約 5–8 秒、以降は約 1 秒。

## デーモンをプラグイン再接続を超えて生存させる

オプションだが、24/7 稼働の Pi なら推奨。デーモンを systemd 配下に置けばプラグイン再起動と Pi 再起動を生き延びます — [[en/cookbook/systemd-managed-daemon|systemd-managed daemon]]（英語） 参照。

## 反対側からも動作確認

Obsidian でノートを編集してから、Pi で:
```bash
ls -lt ~/notes | head
```

最新の編集が一番上に出て、新しい mtime になっているはずです。

## 関連

- [[en/server/raspberry-pi|Server / Raspberry Pi notes]]（英語） — Pi モデル別の性能上限とチューニング
- [[ja/operations/troubleshooting|トラブルシューティング]] — 初回接続が失敗したときに何を確認するか
- [[en/cookbook/ssh-keygen|SSH 鍵の生成]]（英語） — `ssh pi@obsidian-vault.local` がパスワードを要求した場合
