# BRAT Testing & iPhone Obsidian Integration Plan

## 概要

ObsidianプラグインをBRAT（Beta Reviewers Auto-update Tool）経由でiPhone/iOS環境にテスト配布し、モバイル環境での動作を検証する計画。

---

## Current State

### Manifest 設定
```json
{
  "id": "remote-ssh",
  "version": "1.0.48",
  "isDesktopOnly": true,  // ← iPhone/iOS では非表示
  "minAppVersion": "1.5.0"
}
```

### バージョン管理戦略（既実装）
- **Branch**: `next` (beta) / `main` (stable)
- **Beta版**: `X.Y.Z-beta.N` → `manifest-beta.json`へ反映（BRAT --beta 購読者向け）
- **Stable版**: `X.Y.Z` → `manifest.json` へ反映（Obsidian Community Plugins）
- **ファイル同期**: `bump-version.mjs` が自動管理

---

## 課題と制限

### iOS Obsidian の制限
| 制限項目 | 影響 | 対策 |
|---------|------|------|
| **SSH/ネットワークソケット** | クライアント機能の制限 | `isDesktopOnly=true` の理由 |
| **バックグラウンド実行** | 接続保持不可 | フォアグラウンドのみ運用 |
| **ファイルシステムアクセス** | VaultのSFTP同期可 | モバイル向けクライアント実装で対応 |
| **プロセス管理** | SSH daemon 不可 | リモート側（Linux/macOS）で実行 |

### Remote SSH の可用性
- **Desktop環境**: フル機能（SSH server/client の双方向通信）
- **iOS環境**: 
  - ✅ **可能**: リモートサーバーへの読み取り/書き込み（SFTP）
  - ✅ **可能**: 再接続復旧（JSON-RPC）
  - ❌ **不可**: ローカルSSH daemon
  - ❌ **不可**: バックグラウンド同期（Obsidian制限）

---

## 実装計画

### Phase 1: Manifest 対応
**目標**: iPhone での表示/インストールを許可しつつ、iOS 特有の制限を管理

#### 1.1 段階1: `isDesktopOnly` 条件削除
```json
// Before
{
  "isDesktopOnly": true
}

// After
{
  // フィールド削除（デフォルト = false = 全プラットフォーム対応）
}
```

#### 1.2 段階2: iOS-specific documentation
- README に以下を追加:
  - iOS での動作可能な機能リスト
  - 既知の制限事項
  - Vault 同期ワークフロー

### Phase 2: ビルド・配布パイプライン
**目標**: `npm version` コマンドで自動的にベータ版を BRAT へ公開できる状態

#### 2.1 Build Script 確認
```bash
npm run build          # TypeScript コンパイル
npm run build:full    # Server + Plugin ビルド
```

#### 2.2 リリース成果物
- `main.js` (プラグイン本体)
- `manifest.json` (プラグイン設定)
- `styles.css` (UI スタイル)
- `plugin/` ディレクトリ全体

#### 2.3 GitHub Releases 対応
```bash
npm run bump:beta      # X.Y.Z-beta.N に更新
# → manifest-beta.json へ反映
# → GitHub Actions で自動ビルド/リリース
```

### Phase 3: BRAT チャンネル設定
**目標**: iPhone ユーザーが BRAT 経由でベータ版をサブスクライブ可能に

#### 3.1 BRAT リポジトリ URL
```
https://github.com/lalate/obsidian-remote-ssh-gemini
```

#### 3.2 Beta チャンネル対応
BRAT は `manifest-beta.json` を監視:
- **Stable**: `https://raw.githubusercontent.com/.../main/manifest.json`
- **Beta**: `https://raw.githubusercontent.com/.../next/manifest-beta.json`

→ 既に実装済み（`bump-version.mjs`）

### Phase 4: iPhone テスト環境構築
**目標**: iOS デバイスで実際にテスト可能な環境

#### 4.1 前提条件
- Obsidian iOS アプリ（App Store）
- BRAT プラグイン（Community Plugins から）
- リモートサーバー（SSH/SFTP対応）
  - テスト用 Linux/macOS マシン
  - 安全な SSH キー配置

#### 4.2 セットアップ手順
1. **Obsidian iOS インストール**
   ```
   App Store → Obsidian インストール
   ```

2. **Vault 作成**
   - iCloud Drive / OneDrive / Obsidian Sync で同期可能なローカル vault

3. **BRAT プラグイン追加**
   - Settings → Community Plugins → Browse
   - 「BRAT」検索 → Install
   - Enable

4. **Remote SSH Beta チャンネル追加**
   - BRAT → Add Beta plugin
   - Repository: `https://github.com/lalate/obsidian-remote-ssh-gemini`
   - Release channel: `main` (default) or `next` (beta)

5. **プラグインインストール**
   - Remote SSH が Community Plugins に表示
   - Install → Enable

#### 4.3 テスト シナリオ
- [ ] プラグイン UI 表示確認
- [ ] SSH プロファイル設定
- [ ] リモート Vault 接続
- [ ] ファイル読み込み（SFTP）
- [ ] ファイル編集＆保存
- [ ] 再接続復旧
- [ ] Gemini CLI 機能（設定/実行）

---

## ドキュメント

### 必要なドキュメント
1. **README 更新** (`docs/en/index.md`)
   - iOS サポート状況
   - 動作可能な機能リスト
   - 既知の制限

2. **iOS セットアップガイド** (`docs/en/getting-started/ios-setup.md`)
   - Obsidian iOS インストール
   - BRAT 設定
   - リモート接続手順
   - トラブルシューティング

3. **Gemini CLI on iOS** (`docs/en/getting-started/gemini-cli-ios.md`)
   - iOS でのテンプレート設定
   - バックグラウンド実行の代替方法

4. **ベータテストガイド** (`reference/BETA-TESTING.md`)
   - 既実装

---

## 実装スケジュール

| Phase | Task | 優先度 | 状態 |
|-------|------|--------|------|
| 1.1 | `isDesktopOnly` 削除 | High | Not Started |
| 1.2 | iOS サポート文書作成 | High | Not Started |
| 2.1 | Build Script 確認 | Medium | Done |
| 2.2 | GitHub Actions 設定（既存PR参照） | Medium | Pending Review |
| 3.1 | BRAT チャンネル検証 | Medium | To Do |
| 4.1 | テスト環境セットアップ | High | To Do |
| 4.2 | テスト シナリオ実行 | High | To Do |

---

## 技術的検証事項

### バンドル構成
- [ ] `main.js` 内に SSH/SFTP ライブラリが完全に含まれているか
- [ ] iOS の制限（no native modules for Node crypto）でも動作するか
- [ ] xterm.js UI レンダリング が iOS Safari WebView で正常か

### API 互換性
- [ ] WebSocket over iOS（バックグラウンド切断への対応）
- [ ] Blob/ArrayBuffer handling
- [ ] Storage API（ローカル vault vs iCloud Drive）

---

## 次のステップ

1. **承認**: ユーザーから iOS サポート方針の確認 ✅
2. **実装**: `isDesktopOnly` 削除＋ドキュメント整理 → 進行中
3. **Stage 1**: 自分で内部テスト + 動作確認
4. **Stage 2**: 外部 β テスター募集・テスト実行
   → 詳細は [β Testing Program](BETA-TESTING-PROGRAM.md) を参照
5. **Stage 3**: Public Release または Upstream PR

---

## 参考資料

- [iOS Setup Guide](../docs/en/getting-started/ios-setup.md)
- [β Testing Program](BETA-TESTING-PROGRAM.md)
- [BRAT (Beta Reviewers Auto-update Tool)](https://github.com/TfTHacker/obsidian42-brat)
- [Obsidian Plugin Manifest Spec](https://docs.obsidian.md/Plugins/Manifest)
- [Obsidian Mobile Limits](https://docs.obsidian.md/Obsidian+Hub/04+-+Guides%2C+Workflows%2C+%26+Courses/for+Plugin+Developers/JavaScript+API)
- [Project BRAT Channel Setup](../plugin/scripts/bump-version.mjs)
