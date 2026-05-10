---
title: 他の Obsidian 同期ツールとの比較
lang: ja
tags: [comparison, overview]
description: "obsidian-remote-ssh と Obsidian Sync / Syncthing / Dropbox / iCloud / Obsidian Git / Nextcloud / Remotely Save の比較。トポロジーとトレードオフから最適な vault 同期ツールを選ぶ。"
---

# 他の Obsidian 同期ツールとの比較

「Obsidian の vault を複数デバイスで使えるようにしたい」を実現する手段は複数あります。このページは **obsidian-remote-ssh** と主要な代替手段を比較します — このプラグインが**適切でない**ケースも含めて、率直に書きます。

> **このページの精神:** 「最高のツール」というものは存在せず、各ツールはそれぞれのモデルに最適です。Obsidian Sync のモデルが合うなら Obsidian Sync を使ってください。

## 一覧

| | obsidian-remote-ssh | Obsidian Sync | Syncthing | Dropbox / iCloud / OneDrive | Obsidian Git | Nextcloud | [Remotely Save](https://github.com/remotely-save/remotely-save) |
|---|---|---|---|---|---|---|---|
| **トポロジ** | あなたのリモート上の単一正本 | クラウド（Obsidian のサーバ）が正本 | P2P。各デバイスがフルコピーを保持 | クラウドが正本 | git remote が正本 | あなたのセルフホストクラウドが正本 | クラウドが正本 |
| **編集モデル** | リモート直接編集（ローカルにフルコピーなし） | ローカル編集 + バックグラウンド同期 | ローカル編集 + バックグラウンド同期 | ローカル編集 + バックグラウンド同期 | ローカル編集 + 手動 commit/push | ローカル編集 + バックグラウンド同期 | ローカル編集 + 手動同期 |
| **認証** | あなたの SSH 鍵 | Obsidian アカウント | デバイス ID | サービスアカウント | git 認証 (SSH/HTTPS) | Nextcloud アカウント | バックエンドごと |
| **保存時暗号化** | リモートホストの責任（LUKS / FileVault / 暗号化 ZFS） | あなたのパスワードによる E2EE オプションあり | フォルダ単位で対応 | サービス側、E2EE はデフォルトでない | git ホスト依存 | サーバ側、E2EE アドオンあり | バックエンドごと |
| **転送時暗号化** | SSH | TLS + E2EE オプション | TLS | TLS | SSH/HTTPS | TLS | バックエンドごと (TLS) |
| **競合モデル** | mtime precondition、UI に表面化 | ベクトル時計、自動解決 | mtime + version vector、`*-conflict-*` ファイル発生 | mtime、`*-conflict-*` 頻発 | git merge、エディタ / CLI で解決 | サーバ仲介、`(conflict copy)` 発生あり | バックエンドごと |
| **モバイル (iOS / Android Obsidian)** | 非対応、デスクトップ専用 ([#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151)) | フル対応 | Android のみ。iOS は Syncthing 自体未対応 | 対応（iOS sandbox 制限あり） | 一応プラグインあり、不安定 | 対応 (Nextcloud アプリ) | 対応 |
| **コスト** | セルフホスト: 無料 + ハードウェア / VPS 代 | サブスクリプション | 無料 | 無料枠超過後サブスク | 無料 (git ホスト依存) | セルフホスト: 無料 + ハードウェア代 | 無料 + ストレージ代 |
| **Selective sync** | 不可、vault 単位 | 不可 | フォルダ単位 | クライアント次第 | `.gitignore` で手動 | フォルダ単位 | フォルダ単位 |
| **バージョン履歴** | なし — サーバ側バックアップで代替（[[en/cookbook/backup-restore\|recipe]] 英語） | UI からファイル単位で履歴復元（有料） | オプションのファイルバージョニング | 履歴 / ゴミ箱（有料） | git ネイティブ | ファイル単位履歴 | バックエンドごと |
| **オフラインで動くか** | 動かない — SSH 到達性必須 | ローカルキャッシュあり | local-first | ローカルキャッシュあり | local-first | ローカルキャッシュあり | ローカルキャッシュあり (ローカルが vault) |
| **「クラウド」消失時のリスク** | 該当なし — それ自体があなたのクラウド | 復旧まで使用不可 | 該当なし — 全デバイスが保持 | 復旧まで使用不可 | 全 clone に残る | セルフホスト: 同上 | ローカルコピー残存 |

**最重要は最初の "トポロジ" 行**。他の特性すべてはここから派生します。

## ユーザタイプ別の選び方

### 「ただ動いてほしい、モバイルも込みで」

→ **Obsidian Sync**。プロダクト化のコストが反映された有料製品です。運用ストレスをゼロにしたいなら Sync に課金が一番。

### 「全ファイルを全デバイスに、中央サーバなしで」

→ **Syncthing**。P2P、中央なし、無料。代償は競合 UX（`*-conflict-*` ファイル）と Android 限定モバイル。

### 「Dropbox / iCloud / OneDrive に既に課金してる、新しいものを入れる必要は?」

→ **既存ツールでよい**。1 デバイスずつ編集するなら問題なく動きます。古典的な失敗パターンは「ノート PC でオフライン編集 → iPad が一晩で同期 → ファイルを開いたら本物の隣に `(conflict copy)` がある」。これと折り合いをつけられるなら OK。

### 「git ライクな全変更履歴が欲しい」

→ **Obsidian Git プラグイン**。保存（または間隔）ごとに commit。履歴は強力、モバイルは脆弱、git 思考が必要。

### 「homelab 持ちでセルフホスト派」

→ **Nextcloud か このプラグイン**。フルレプリカ（vault が全デバイスにある）+ 豊富なエコシステムなら Nextcloud。**単一正本**（レプリカを管理しなくてよい、デバイスごとのディスク使用なし、edit-on-server モデル）ならこのプラグイン。

### 「このプラグインのモデルそのもの: vault はリモートに、レプリカなし」

→ **obsidian-remote-ssh**。これがこのプロジェクトのニッチです。

## obsidian-remote-ssh が適切なケース

このモデルが合うのは:

- **常時到達可能なリモートを所有している**（Tailscale 越しの自宅 Pi、NAS、VPS、職場開発機など）
- **vault の N コピーを持ちたくない** — 単一正本がそのまま欲しい。「どのデバイスが最新か」問題が発生しない
- **既に SSH 鍵 + Linux 思考** — 既存のセットアップに SSH ホストを 1 つ追加するのは運用負荷ほぼゼロ
- **第三者クラウドを許容しないプライバシー要件** — ノートはあなたのサーバ以外に渡らない
- **デスクトップ中心** — モバイルが「あったら良い」程度なら問題なし。必須要件なら下を参照
- **巨大 vault (10k+ files)** — プラグインは遅延フェッチ。各 PC に数万ファイルを保持しなくて済む

## obsidian-remote-ssh が不適切なケース

正直なところ — 不適切な理由で間違ったツールを選ぶのは自分が困るだけです:

- **モバイルで編集したい** — デスクトップ専用 ([#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151))。Obsidian Sync か、モバイル Obsidian + Syncthing/Nextcloud を
- **オフライン頻発** — SSH 到達不可 = 編集不可。レプリケーション系（Sync, Syncthing, Dropbox, Nextcloud）はオフラインでも編集できる
- **そもそもリモートを持っていない** — このプラグインのために VPS を立てるのは別に問題ないが、「インフラを持ちたくない」が目標なら Sync か Syncthing を
- **UI からファイル単位 undo したい** — 提供してません。Sync（有料）か git 系か、サーバ側 [[en/cookbook/backup-restore|restic backup]]（英語）と組み合わせて「undo は CLI 復元」と割り切るか
- **リアルタイム共同編集** — どのツールでも 2 人同時編集は競合領域だが、このプラグインは特に厳しい（mtime check で片方が conflict）。共同編集ワークフローには HedgeDoc / etherpad 系を見るべき

## 個別ペアの深掘り

### vs Obsidian Sync

精神的に最も近い競合（両方とも "Obsidian-aware sync"）。境界線は **正本を誰が所有するか**:

- Sync: Obsidian のサーバ。サブスクで モバイル + ファイル単位履歴 + クロスデバイス E2EE が手に入る
- このプラグイン: あなたのサーバ。無料、運用面が広い、モバイル未対応

Obsidian Sync は良いプロダクトです。サブスク代を払えてデータレジデンシー的にも問題ないなら、低摩擦の選択肢。このプラグインは**特にセルフホストが目的**の人向け。

乗り換え予定なら [[en/migration/from-obsidian-sync|専用の migration ガイド]]（英語）。

### vs Syncthing

Syncthing は **逆方向のトポロジ** — 「中央サーバ」ではなく「全デバイスがフルコピーを持ち peer 間で gossip」。長所:

- 真の P2P、中央が一切ない
- 無料、セルフホスト、成熟
- 全デバイスで完全オフライン動作

このプラグインより難しい点:

- **全デバイスでディスク圧迫** — 5 GB の vault は全デバイスで 5 GB 使う
- **競合 UX** — 2 ノート PC で同ファイルを編集すると `*-sync-conflict-...md` が生まれ、手動で reconcile。（このプラグインも 2 クライアント同時編集で競合は起きるが、保存前に Obsidian UI 側で表面化する）
- **iOS Obsidian なし** — Syncthing そのものが iOS 非対応

ノート PC 1 台 + Android スマホ 1 台なら Syncthing は良い。デバイスが 4 台 + スマホとなると、ディスク + 競合の話がこのプラグインの中央サーバ型より厄介になる。

### vs Dropbox / iCloud / OneDrive

動くは動くが **Obsidian は同期フォルダ内のアクティブ vault を明示的に非推奨にしている**。古典的失敗: `.obsidian/workspace.json` が書き込み中に踏まれる、プラグインキャッシュ同士の race、編集中の添付ファイルが同期される。それでもみんな zero-setup を理由に使い、大抵は動くがそうでないこともある。

クラウドストレージ経路は以下なら OK:

- 同時編集デバイスが 1 つだけ
- たまの conflict-copy 手動掃除を許容できる
- `.obsidian/` に頻繁書き込みするヘビーなプラグイン群を使ってない

これらが当てはまらないなら、Obsidian-aware なツール — Sync、このプラグイン、Syncthing — を。

### vs Obsidian Git

「保存ごとに commit したい」場合は美しい:

- `git log` / `git blame` による本物のバージョン履歴
- 任意の git ホスト（GitHub, GitLab, セルフホスト Gitea / Forgejo）で動く
- 無料

代償:

- **モバイルが脆い** — 各種モバイル Git プラグインは存在するが、認証変更、巨大リポジトリ、iOS のバックグラウンド同期制限などで頻繁に壊れる
- **競合解決が git 風** — `vim` で merge conflict 解決できるなら問題なし、できないなら使い勝手の崖
- **大きい添付（画像 / PDF）が git 履歴を肥大化** — Git LFS が答えだが、Obsidian vault 内で正しく設定するのは非自明

しばしば最良なのは **このプラグイン + リモートで日和見的に git mirror**（リモートで `git commit -am snapshot && git push` を 1 時間ごとに cron）。このプラグインの編集モデル + git の履歴が両立し、Obsidian 側は git を意識せずに済む。

### vs Nextcloud (Obsidian クライアント連携)

Nextcloud は「セルフホスト全部入りクラウド」が欲しい場合の自然な答え。Obsidian 観点での比較:

- Nextcloud のデスクトップ / モバイルクライアントがファイルをローカルフォルダに同期、Obsidian はそのフォルダを vault として開く。形は Dropbox と同じだがセルフホスト
- Dropbox と同じ「同期フォルダ内 vault」の鋭利な角が出る。ただし Nextcloud の競合処理は一般により綺麗
- **モバイル動作する** — Nextcloud の iOS / Android アプリは成熟
- **運用面でかなり重い** — PHP スタック、データベース、定期アップグレード、たまにストレージ corruption。Nextcloud をきちんと運用するのはそれ自体が時間投資

既に Nextcloud を運用しているなら、このプラグインは不要かもしれない。Obsidian のためだけに新たに導入するなら、このプラグインのほうがずっと小さい surface area。

### vs Remotely Save プラグイン

[Remotely Save](https://github.com/remotely-save/remotely-save) は人気の「vault を S3 / Dropbox / OneDrive / WebDAV に同期」プラグイン。モデルが違う:

- Remotely Save: local-first、リモートオブジェクトストアへの周期同期。vault は全デバイスに、クラウドは sync target
- このプラグイン: remote-first、サーバを直接編集。vault はリモートのみ、ローカルは window

Remotely Save が向くケース:

- local-first モデルを保ちたい（オフライン編集、高速ファイル op）
- リモートが SSH ホストではなくオブジェクトストア (S3, R2, Backblaze, OneDrive) である
- モバイル必須

このプラグインが向くケース:

- vault の N コピーが嫌
- SSH 到達可能なホストがある
- LAN / Tailscale 越しに sub-second なファイルオープンが欲しい（デバイス間の "sync delay" がない）

> 余談: このリポジトリはもともと Remotely Save の fork から始まり、アーキテクチャが乖離して別プロジェクト化しました。目標が違い、トレードオフも違う。

## 「2 つ並行して使える?」

可能 — 互いに排他ではない:

- **このプラグイン + Obsidian Sync (モバイル限定)**: Sync をモバイル橋渡しだけに使い、デスクトップはこのプラグインで。Sync から見るとリモート vault は単なるファイル群で、競合面は「モバイル編集とデスクトップ編集が衝突するか」だけ — これはツール 1 個でも同じ問題
- **このプラグイン + git mirror**: 上で書いた通り — リモートで時間ごとに `git commit && git push` cron、編集経路に履歴コストを払わずに git 履歴を得る
- **このプラグイン + restic / borg backup**: バージョン履歴が重要なら必須の組み合わせ。[[en/cookbook/backup-restore|backup recipe]]（英語）

**レプリケーション系**を 2 つ重ねるのはダメ（Sync + Syncthing を同 vault に当てるのは grief レシピ）。**非レプリケーション系**との組み合わせ（モバイル橋、履歴 snapshot、バックアップ）はむしろ正解になることが多い。

## 関連

- [[ja/faq|FAQ]] — 短い比較表 + よくある質問
- [[en/migration/from-obsidian-sync|Obsidian Sync からの移行]]（英語） — 既にこちらを選んだ場合
- [[en/cookbook/backup-restore|Backup & restore]]（英語） — バージョン履歴ニーズの必須相棒
- [[en/architecture/index|Architecture]]（英語） — remote-first モデルの実装
- [[en/roadmap|Roadmap]]（英語） — モバイル計画（v2.0）含む
