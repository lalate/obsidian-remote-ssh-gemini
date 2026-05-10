---
title: インストール
lang: ja
tags: [getting-started, install]
---

# obsidian-remote-ssh のインストール

**Obsidian Community Plugins ストア**（stable）または **BRAT**（beta チャネル — 新機能はここに先に届きます）からインストールできます。両者は同じプラグインコードベースを配布し、違いは BRAT / Obsidian がどの manifest を取得するかだけです。

## オプション 1 — Community Plugins ストア（stable）

> ステータス: **申請中**。現時点では BRAT 経由のインストールを推奨します。

1. Obsidian → **Settings** → **Community plugins** を開く
2. **Restricted mode** が有効なら無効化
3. **Browse** をクリック、**Remote SSH** を検索
4. Install → Enable

## オプション 2 — BRAT（beta チャネル）

[BRAT](https://github.com/TfTHacker/obsidian42-brat) は GitHub リポジトリの `manifest-beta.json` から直接プラグインをインストールするツールです。`next` ブランチに入った修正を即日入手したい場合に推奨。

1. まず Community Plugins ストアから **BRAT** をインストール
2. BRAT 設定 → **Add Beta plugin**
3. リポジトリスラグを貼り付け:
   ```
   sotashimozono/obsidian-remote-ssh
   ```
4. **--beta** を選択（stable の `manifest.json` ではなく `manifest-beta.json` を追跡させる）
5. 数秒待ってダウンロード後、Community Plugins で **Remote SSH** を有効化

BRAT は Obsidian 起動時に自動更新します。特定バージョンに固定したい場合は BRAT の "Auto-update at startup" を OFF に。

## オプション 3 — 手動インストール

エアギャップされた Obsidian や、ロード前にバンドルを検査したい場合用。

1. [Releases](https://github.com/sotashimozono/obsidian-remote-ssh/releases) から最新の release artefacts をダウンロード:
   - `main.js`（プラグインバンドル）
   - `manifest.json`
   - `styles.css`
2. 3 ファイルを以下にコピー:
   ```
   <vault>/.obsidian/plugins/remote-ssh/
   ```
3. Obsidian を再起動 → **Settings** → **Community plugins** で **Remote SSH** を有効化

## サーバ側

プラグインは接続時に **署名済みデーモンバイナリ**（`obsidian-remote-server`）を自動でリモートに配置します — 通常は手動インストール不要です。何がどこに配置されるかは [[en/server/overview|Server / deploy]]（英語）、デーモンを自分で検証したい場合は [[en/security/cosign-verify|Cosign verification]]（英語）を参照。

## 動作要件

| 項目 | 内容 |
|---|---|
| Obsidian | 1.5.0 以降 |
| ローカル OS | macOS、Linux、Windows |
| リモート OS | Linux (amd64 / arm64)、macOS (Intel / Apple Silicon) |
| リモート SSH | OpenSSH 8.0+ 推奨。パスワード / 公開鍵 / SSH agent 認証すべてサポート |
| モバイル | 未対応 — [モバイルリレー トラッカー](https://github.com/sotashimozono/obsidian-remote-ssh/issues?q=label%3Amobile) 参照 |

次: [[ja/getting-started/first-connect|初回接続]]。
