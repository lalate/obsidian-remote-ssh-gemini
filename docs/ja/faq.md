---
title: FAQ
lang: ja
tags: [faq]
---

# FAQ

繰り返し聞かれる質問と、最短の有用な回答です。

## Obsidian Sync / Syncthing / Dropbox との違いは?

| | obsidian-remote-ssh | Obsidian Sync | Syncthing / Dropbox |
|---|---|---|---|
| ファイルの所在 | あなたのリモートホスト上の単一の正本 | クラウド（Obsidian のサーバ） | 全デバイスにレプリケート |
| 認証 | あなたの SSH 鍵 | Obsidian アカウント | サービスアカウント |
| 競合モデル | mtime precondition、デーモン仲介 | ベクトル時計、クラウド仲介 | ファイル更新時刻、`*-conflict-...` ファイル発生リスクあり |
| クラウドが落ちたら | 該当なし — クラウド自体が存在しない | vault 復旧まで使用不可 | ローカルコピーは引き続き使用可 |
| コスト | セルフホスト（無料） | サブスクリプション | 無料枠は条件次第 |
| モバイル | 未対応 | 対応 | 対応（Android sandbox 制限あり） |

選択は信頼モデル + 運用の好み次第です。既に信頼できるサーバを持っており、第三者クラウドを介在させたくない場合、このプラグインが適しています。

Obsidian Git / Nextcloud / [Remotely Save](https://github.com/remotely-save/remotely-save) プラグインまで含めた拡張比較は [[ja/comparison|比較ページ]] を参照してください。

## モバイルで動きますか?

未対応です。[モバイルリレー マイルストーン](https://github.com/sotashimozono/obsidian-remote-ssh/issues?q=label%3Amobile) で追跡中。現在のアーキテクチャはリモートでデーモンバイナリを spawn しますが、これは Obsidian が Electron のデスクトップでは問題なく動きます。モバイル（iOS / Android Obsidian）には OS が任意のサブプロセスを spawn させてくれないため、リレーコンポーネントが必要です。

## 同じ vault を複数クライアントから編集できますか?

可能です — そう設計されています。各クライアントが独自の shadow vault と独自のデーモンセッションを持ちます。衝突は [[en/user-guide/conflicts|conflict handling]]（英語）フローで表面化します。

既知の鋭利な角: ワークスペース状態（開いているタブ、ペインサイズ）はクライアントごとで、`.obsidian/user/<client-id>/` 配下に格納されます。一部のプラグインがワークスペース系状態をメインの `.obsidian/workspace.json` に置く実装になっていると、それは依然として race します。良い解決策はまだありません — 該当するケースに当たったら issue を立ててください。

## ローカルマシンが Windows / Linux / macOS の場合は?

3 種すべて対応。ローカル OS は Obsidian が動く場所というだけです。

## リモートホストが Windows でも動きますか?

現時点では未対応。デーモンは Linux (amd64 / arm64) と macOS (Intel / Apple Silicon) ビルドです。Windows + WSL は動作します（WSL をリモートとして扱う — デーモンは Linux で動く）。ネイティブ Windows + OpenSSH server はロードマップにありますが未着手。

## デーモンなし（SFTP のみ）で使えますか?

可能です — profile の Mode を `sftp` に。デーモンデプロイなし、op ごとのレイテンシが遅くなります（約 50–100 ms vs 約 5–10 ms）、`fs.watch` push 通知もなくなります（プラグインが poll で変更検出に切り替わる）。リモートにバイナリを配置できない（権限制限のあるホスティング、制限シェル など）場合に有用です。

## このプラグインは第三者にデータを送りますか?

送りません。すべての通信はあなたの SSH 接続経由です。テレメトリカウンタ（opt-in、デフォルト OFF）はローカル限定 — コードベースには "phone home" 経路は存在しません。

## なぜ `~/.ssh/known_hosts` とは別の `known_hosts` を持つのですか?

信頼スコープのためです。詳細は [[en/security/host-keys|Host-key trust]]（英語）。

## 接続のたびにデーモンを再デプロイしますか?

いいえ — プラグインは最初に reuse probe を走らせます（[[en/server/auto-deploy#what-happens-in-order|auto-deploy step 2]] (英語)）。前回のデーモンの socket + token が健在で protocol version が一致すれば、attach してバイナリアップロードを完全にスキップします（約 1 秒の再接続、対する初回は約 5 秒）。

deploy fallback は probe が失敗したときだけ発動します — 通常はデーモンがまだ起動していない（初回接続または再起動後）、token がない、デーモンの protocol version が現プラグインバンドルが期待するものと一致しない、のいずれか。

リモートデーモンを [[en/server/systemd|systemd]]（英語）下で動かしておけば、reuse 経路が毎接続でクリーンに拾います — 追加フラグ不要。

## クリーンにアンインストールするには?

ローカル:
- Obsidian → Community Plugins でプラグインを無効化
- `<vault>/.obsidian/plugins/remote-ssh/` を削除

リモート（接続したホストごとに）:
```bash
ssh user@host
pkill -f obsidian-remote-server
rm -rf ~/.obsidian-remote/
```

vault ファイルそのものは触りません。プラグインはシステムファイルにも一切触れません。

## セキュリティ問題はどこに報告すれば?

GitHub Security Advisories: [obsidian-remote-ssh/security/advisories/new](https://github.com/sotashimozono/obsidian-remote-ssh/security/advisories/new)。協調的開示が望ましいです。

## 機能 X が欲しい。どこに言えば?

「あったらいいな」は [GitHub discussion](https://github.com/sotashimozono/obsidian-remote-ssh/discussions) に。具体的なバグや計画機能の要望は [GitHub issue](https://github.com/sotashimozono/obsidian-remote-ssh/issues) に。PR 歓迎 — [[en/contributing/documentation|the contributor docs]]（英語）参照。
