---
title: セキュリティ
lang: ja
tags: [security]
---

# セキュリティ

脅威モデルと、それに対する防御メカニズムです。まず [[ja/security/model|脅威モデル]] を読んでください — 他のページはそれを実装する可動部品です。

## ページ一覧

| ページ | 内容 |
|---|---|
| [[ja/security/model\|脅威モデル]] | 何を防御し、何を保証し、何が明示的にスコープ外か |
| [[en/security/host-keys\|Host-key trust]]（英語） | プラグイン独自の known-hosts ストア（`~/.ssh/known_hosts` とは別）、信頼ダイアログ、ホスト鍵ローテーション |
| [[en/security/token\|Token handling]]（英語） | 32 バイトのデーモンセッショントークン: 生成、ディスク上のライフサイクル、漏洩時の挙動 |
| [[en/security/cosign-verify\|Cosign verify]]（英語） | ダウンロードしたデーモンバイナリの Sigstore キーレス検証 — ワークフローが何に署名し、どう検証するか |

## 読む順序

1. **[[ja/security/model|脅威モデル]]** — 他のページはここを読んだ前提
2. **[[en/security/host-keys|Host-key trust]]**（英語） — セキュリティ表面で最もユーザに近い部分
3. **[[en/security/token|Token handling]]**（英語） + **[[en/security/cosign-verify|Cosign verify]]**（英語） — 運用者向け詳細

## 関連

- [[en/api/authentication|API → Authentication]]（英語） — ワイヤレベル認証ハンドシェイク（[[en/security/token|Token handling]] のトークンを使う）
- [[en/architecture/release-pipeline|Release pipeline]]（英語） — CI でのデーモンバイナリ署名フロー
- [[en/privacy|Privacy & data handling]]（英語） — 隣接トピック（「何を防御するか」とは別の「どんなデータがどこに流れるか」）

## 脆弱性報告

GitHub Security Advisories: [obsidian-remote-ssh/security/advisories/new](https://github.com/sotashimozono/obsidian-remote-ssh/security/advisories/new)。協調的開示が望ましいです。
