---
title: Obsidian Sync からの移行
lang: ja
tags: [migration, how-to]
description: "Obsidian の有料 Sync サービスから obsidian-remote-ssh への移行ガイド。段階的な移行手順、ロールバック計画、代替機能、既知のギャップ。"
---

# Obsidian Sync からの移行

Obsidian Sync（Obsidian 公式の有料同期サービス）から obsidian-remote-ssh への乗り換えガイドです。Sync の「Obsidian のサーバ上に vault」モデルを「**あなたの**リモートホスト上に vault」モデルに置き換えます — エンドユーザ体験は同じ、所有権の物語が違うだけ。

> **スコープの正直なところ:** このページはこのプラグイン側のセットアップで検証可能な部分を扱います。Obsidian Sync 内部の挙動（履歴保持、E2EE 鍵管理、バージョン復元のセマンティクス）の正典は [Obsidian 公式の Sync ドキュメント](https://help.obsidian.md/Obsidian+Sync/Obsidian+Sync) です。本ガイド中に「Obsidian のドキュメントで確認してください」と書いてある箇所は意図的な余白で、手抜きではありません。

## 残るもの、失うもの

### 残るもの

- **vault の中身すべて** — `.md` ファイル、添付、`.obsidian/` プラグイン設定、テーマ
- **複数デバイスでの編集** — 両方とも対応。obsidian-remote-ssh は [[en/architecture/collab|Client ID ごとのワークスペース分離]]（英語）で並行クライアントを処理
- **サブスクリプション解約** — Obsidian Sync は不要になる。移行検証後に解約してよい

### 失うもの（と代替）

| Obsidian Sync の機能 | obsidian-remote-ssh での代替 |
|---|---|
| **ファイルバージョン履歴**（Sync UI からファイル単位で巻き戻し） | プラグインに組み込みなし。サーバ側バックアップで代替 — [[en/cookbook/backup-restore\|restic / borg / rsync レシピ]]（英語） |
| **E2EE**（あなたの暗号化パスワードによる） | SSH 転送が転送中暗号化を担当。**保存時暗号化はリモートホスト側の責任**（LUKS / FileVault / 暗号化 ZFS dataset）。Obsidian Sync の独立パスワードによる E2EE は再現されない |
| **デバイス間の自動 conflict 解決** | プラグインには [[en/user-guide/conflicts\|conflict 検出]]（英語）はあるが、解決 UI は容赦なく — 拒否された側の自動バックアップなし。先にそのページを読むこと |
| **モバイル同期** | 未対応 — このプラグインはデスクトップ専用（[[en/roadmap\|#151 で追跡]] 英語）。モバイル編集が必須なら Sync を残す |
| **誤削除ノートのワンクリック復元** | サーバ側バックアップから復元（[[en/cookbook/backup-restore\|レシピ]] 英語） |
| **Selective sync**（一部フォルダのみ） | 非対応。プラグインは設定された vault root 全体を同期 |

これらが workflow に必須なら移行を再考、もしくは必要部分だけ Sync を残す（モバイルだけ Sync、デスクトップはこのプラグイン、など）。

## 移行前チェックリスト

1. **vault の置き場所を決める** — 自宅 Pi、NAS、クラウド VPS。[[ja/cookbook/raspberry-pi-vault|RPi vault ゼロから]] または [[en/cookbook/share-via-tailscale|Tailscale 共有ホスト]]（英語）参照
2. **信頼できる Sync 履歴 snapshot を取る** — 最も最新のデバイスで Obsidian を開き、Sync が "Synced" になるのを待つ。移行ウィンドウの間は編集を止める
3. **切替えウィンドウを計画する** — 一般的な vault で 30 分
4. **ロールバック計画を持つ** — 新セットアップが数日きれいに動くまで Sync サブスクリプションを残しておく

## 移行ステップ

### 1. vault をノート PC にエクスポート

Sync は正本を Obsidian のサーバに保存し、ローカルコピーは同期されたレプリカです。移行ではローカルレプリカからコピーします。

最後に "Synced" になったデバイスで:

```bash
# vault のディスク上パス（Obsidian で開いているもの）
# macOS: ~/Documents/MyVault, Linux: ~/MyVault, Windows: C:\Users\you\Documents\MyVault

cp -a ~/MyVault ~/MyVault-migration-snapshot
```

`-a` でタイムスタンプと symlink を保持。この snapshot が「すべて失敗した場合の最終手段」コピーです。

### 2. Sync 固有の状態を削除（任意だがクリーン）

vault の `.obsidian/` ディレクトリ内に Sync が状態ファイルを書きます。残しても害はないが、削除しても害はありません:

```bash
# Sync 状態を削除（再有効化すれば Sync が再生成。こちらは無視する）
rm -f ~/MyVault-migration-snapshot/.obsidian/sync.json
rm -rf ~/MyVault-migration-snapshot/.obsidian/sync/   # 存在する場合のみ
```

他の `.obsidian/` ファイル（テーマ、プラグイン、ホットキー、ワークスペース状態）は触らずに連れて行く。

> 注: Sync のディスク上状態ファイルの完全な目録は持っていません。上記の `sync.json` と `sync/` がよくある名前です。Obsidian の Sync ドキュメントを確認するか、`.obsidian/` ディレクトリ内で `sync*` 系で他プラグイン由来でないものを探してください。

### 3. リモート vault ホストをセットアップ

[[ja/cookbook/raspberry-pi-vault|Pi レシピ]] または同等の手順で:

```bash
ssh user@new-host 'mkdir -p ~/notes'
```

### 4. vault をアップロード

```bash
rsync -aHx ~/MyVault-migration-snapshot/ user@new-host:~/notes/
```

大きい vault（1+ GB）を WAN 経由で転送するのは時間がかかります。tar-pipe のほうが速いことが多い:

```bash
tar czf - -C ~/MyVault-migration-snapshot . | ssh user@new-host 'tar xzf - -C ~/notes'
```

リモート側でコピーを検証:

```bash
ssh user@new-host 'find ~/notes -type f | wc -l'    # ファイル数
ssh user@new-host 'du -sh ~/notes'                  # 合計サイズ
# ローカル snapshot と比較
```

### 5. Obsidian Sync を無効化

Obsidian → Settings → Sync → トグル OFF。**Obsidian のサーバ上の Sync データはまだ削除しない** — それがロールバック経路。

### 6. obsidian-remote-ssh をインストール

[[ja/getting-started/install|標準のインストール手順]]（Community Plugins ストアか BRAT）でインストール。`user@new-host` を指す profile を追加し、vault path は `~/notes`。Connect。新しい shadow vault に vault 全部の中身が現れます。

裏で何が起こっているかは [[ja/getting-started/first-connect|初回接続]] 参照。

### 7. すべて動くか検証

- **数件のノートを開く** — 画像 / 添付付きも含めて。正しくレンダリングされるか
- **編集 + 保存** をしてみる。リモート側で確認: `ssh user@new-host 'ls -lt ~/notes | head -3'` — 編集が一番上にあるはず
- **主要プラグインを確認** — Dataview / Templater / Excalidraw など。リモート vault の `.obsidian/plugins/` 配下にあるので動くはず。既知の鋭利な角は [[en/user-guide/plugin-compatibility|プラグイン互換性マトリクス]]（英語）参照
- **テーマ + ホットキー** が反映されているか
- **Sync を解約する前に 1 週間運用する** — 何か欠けているものを見つける時間を確保

### 8. バックアップを設定（Sync 履歴の必須代替）

Obsidian Sync にはファイル単位のバージョン履歴がありましたが、このプラグインにはありません。代替はサーバ側のインクリメンタルバックアップです。Sync を解約する**前に** [[en/cookbook/backup-restore|バックアップレシピ]]（英語） に従って restic か borg を設定してください — 両方を同時に失うと復旧不能。

### 9. Obsidian Sync を解約

クリーンに 1 週間運用 + バックアップ snapshot 検証済みになったら、Obsidian Sync サブスクリプションを解約。必要なら Obsidian のアカウント管理プロセスに従ってサーバ上の vault データの削除を要求。

## 複数デバイスへの引き継ぎ

Sync で複数ノート PC を同期させていたなら、各ノート PC ごとにこの手順を繰り返す:

1. ノート PC B に obsidian-remote-ssh をインストール
2. 同じ profile（host + path）を追加 — ワークスペース状態を共有したいなら同じ `Client ID`、各デバイスで独自のペインレイアウトが欲しいなら別の Client ID
3. Connect — ノート PC B の shadow vault は、ノート PC A が編集しているのと同じリモートから再フェッチします

デバイスごとのワークスペース状態は [[en/configuration/this-device|Client ID partition]]（英語）で分離されたまま。並行編集は [[en/user-guide/conflicts|conflict handling]]（英語）を経由。

## ロールバック（移行が崩れた場合）

Sync が Obsidian のサーバ側でまだ生きているうちなら:

1. Obsidian で Sync を再有効化
2. Sync がサーバ側コピーからローカル vault を再構築（少し時間がかかる）
3. 何が悪かったか分かるまで obsidian-remote-ssh の使用を停止

`~/MyVault-migration-snapshot` の事前 snapshot は、Sync のサーバ側コピーも壊れていた場合の二次フォールバック。

## 関連

- [[ja/getting-started/install|インストール]] — obsidian-remote-ssh を入れる
- [[ja/cookbook/raspberry-pi-vault|RPi vault ゼロから]] — 新しい vault ホストとして自宅サーバを立てる
- [[en/cookbook/backup-restore|Backup & restore]]（英語） — Sync 履歴の必須代替
- [[en/user-guide/conflicts|Conflict handling]]（英語） — 上書き時の自動バックアップが無いという重要な文脈
- [[ja/faq|FAQ]] — Sync / Syncthing / Dropbox との簡易比較表
- [Obsidian Sync ドキュメント](https://help.obsidian.md/Obsidian+Sync/Obsidian+Sync) — 移行中の Sync 挙動の正典
