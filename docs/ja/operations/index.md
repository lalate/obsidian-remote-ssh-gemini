---
title: 運用
lang: ja
tags: [operations]
---

# 運用

プラグインが動いている状態で「**運用する**」場面 — ログを読む、不具合を切り分ける、速度を調整する、アップグレード、アンインストール — のページ群です。症状 → 対処の対応表として使ってください。

## ページ一覧

| ページ | こんなとき読む |
|---|---|
| [[ja/operations/troubleshooting\|トラブルシューティング]] | 何かが動かない。症状 → 原因 → 対処のマップ。**「壊れた」系の質問はまずここから。** |
| [[en/operations/performance-tuning\|Performance tuning]]（英語） | 「動くけど遅い」。ネットワーク / ディスク / inotify / デーモン側キャッシュのチューニング |
| [[en/operations/reconnect\|Reconnect behaviour]]（英語） | SSH リンクが切れたときの挙動とリトライ設定 |
| [[en/operations/daemon-panel\|Daemon panel]]（英語） | Settings → Daemon UI: ステータスバッジ、ログビューア、再起動ボタン |
| [[en/operations/logs\|Logs]]（英語） | 各種ログの保存場所、ローテーション、機微情報の扱い |
| [[en/operations/upgrading\|Upgrading]]（英語） | 新バージョンが届く仕組みと、デーモン再デプロイのタイミング |
| [[en/operations/uninstalling\|Uninstalling]]（英語） | クリーンアンインストール — ローカルのプラグイン状態 + リモートのデーモンファイル |

## 読む順序

特定の順序はありません — 運用ドキュメントは順番にではなく症状から到達するものです。最も「最初に読むべき」に近いのは [[ja/operations/troubleshooting|トラブルシューティング]] で、ここが他ページへのディスパッチャになっています。

## 関連

- [[en/api/errors|エラーコード]]（英語） — ログに現れるエラー名の意味
- [[en/security/model|Security model]]（英語） — デーモンが何に触ってよいか
- [[en/contributing/release-flow|Release flow]]（英語） — バージョンが作られる流れ（届いたアップデートに何が入っているか把握する助けに）
