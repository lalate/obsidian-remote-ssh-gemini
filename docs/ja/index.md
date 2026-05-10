---
title: obsidian-remote-ssh
lang: ja
tags: [home]
description: "Obsidian の vault を SSH/SFTP 経由でリモート編集できるプラグインの日本語ガイドです。Raspberry Pi や NAS、VPS の vault に Obsidian から直接アクセス。"
---

> **Obsidian の vault を SSH/SFTP 経由でリモート編集できるプラグインです** — VS Code Remote-SSH の Obsidian 版だと思ってください。
>
> Raspberry Pi、自宅 NAS、VPS、その他 SSH 到達可能な Linux/macOS ホスト上の vault を、Obsidian から直接編集できます。サーバ側の小さな署名済みデーモンがファイル同期を担当するので、ノートが第三者のクラウドを経由することはありません。

## まずはここから

| やりたいこと | 読むページ |
|---|---|
| 5 分で試したい | [[ja/getting-started/quickstart\|Quickstart]] |
| 一通り順を追ってセットアップを理解したい | [[en/tutorial\|Tutorial — zero to a working vault]] (英語) |
| インストール先と挙動を把握したい | [[ja/getting-started/install\|インストール]] → [[ja/getting-started/first-connect\|初回接続]] |
| よくある質問を見たい | [[ja/faq\|FAQ]] |
| 他の同期ツールと比較して選びたい | [[ja/comparison\|比較]] |
| Obsidian Sync から乗り換えたい | [[ja/migration/from-obsidian-sync\|Obsidian Sync からの移行]] |
| セキュリティモデルを把握したい | [[ja/security/model\|脅威モデル]] |
| Pi で自宅サーバを立てたい | [[ja/cookbook/raspberry-pi-vault\|Raspberry Pi vault from scratch]] |
| 動かないときの対処を調べたい | [[ja/operations/troubleshooting\|トラブルシューティング]] |

## このドキュメントの言語について

現在、日本語版は **主要ページのみ翻訳済み** です。各ページから [[en/index\|英語ドキュメント]] への横移動が可能で、未翻訳のページにも英語版から到達できます。日本語化リクエストは [GitHub Issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues) でお寄せください。

## セクション一覧

- **[[ja/getting-started/index|はじめに]]** — インストール、初回接続、何が起こるか
- **[[ja/cookbook/index|Cookbook]]** — 目的指向のレシピ集（Pi 立て上げ、SSH 鍵生成、Tailscale、systemd など）
- **[[ja/operations/index|運用]]** — トラブルシューティング、性能チューニング、ログ、アップグレード（症状別ディスパッチャ含む）
- **[[ja/security/index|セキュリティ]]** — 脅威モデル、ホスト鍵信頼、トークン管理、cosign 検証
- **[[ja/migration/index|移行]]** — 既存サービスからの乗り換えガイド
- **[[ja/comparison|比較]]** — Obsidian Sync / Syncthing / Dropbox / Git ベース / Nextcloud / Remotely Save との違い
- **[[ja/faq|FAQ]]** — よくある質問

> 上記以外のセクション（API リファレンス、アーキテクチャ、Cookbook、サーバ運用など）は現在英語のみです。[[en/index|英語版トップ]] からアクセスしてください。

## リリースチャネル

| チャネル | manifest 参照先 | インストール方法 | 更新頻度 |
|---|---|---|---|
| **Stable** | `manifest.json` (リポジトリ root) | Obsidian Community Plugins | `next` を `main` へ promote 時（手動） |
| **Beta** | `manifest-beta.json` (リポジトリ root) | [BRAT](https://github.com/TfTHacker/obsidian42-brat)（slug `sotashimozono/obsidian-remote-ssh`、**--beta**） | `next` への merge ごと（継続的） |

バージョン文字列がチャネルを決めます: `1.0.43` は stable、`1.0.44-beta.N` は prerelease です。

## プロジェクトの状態

1.0 リリース済み。shadow vault アーキテクチャは稼働中で、BRAT 経由で日常使用しているユーザがいます。Community Store への掲載は Obsidian チームのレビュー待ちです（[obsidianmd/obsidian-releases#12390](https://github.com/obsidianmd/obsidian-releases/pull/12390)）。モバイル対応（iOS / Android）は v2.0 マイルストーンとして保留中（[#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151)）。最新ロードマップは [GitHub Issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues) を参照してください。

## ライセンス

[MIT](https://github.com/sotashimozono/obsidian-remote-ssh/blob/main/LICENSE)
