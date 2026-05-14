# iOS セットアップガイド

Obsidian iOS アプリを使用して、Remote SSH プラグインでリモートサーバーの vault に接続する手順を説明します。

## 前提条件

### iPhone/iPad の要件
- **OS**: iOS 14.0 以上
- **Obsidian**: v1.5.0 以上（App Store）
- **BRAT プラグイン**: Community Plugins から入手可能

### リモートサーバーの要件
- **OS**: Linux / macOS
- **SSH サーバー**: 起動状態（sshd）
- **SFTP**: SSH に統合（通常は自動）
- **ネットワーク**: iPhone からアクセス可能（同一 LAN または VPN 経由）

---

## ステップ1: Obsidian iOS インストール

1. **App Store を開く**
   ```
   iPhone/iPad の App Store アプリ
   ```

2. **「Obsidian」を検索**
   ```
   検索タブ → 検索バーに「Obsidian」入力
   ```

3. **インストール**
   ```
   「入手」→ Face ID/Touch ID で認証 → インストール
   ```

4. **起動**
   ```
   「開く」または ホーム画面から Obsidian アイコンをタップ
   ```

---

## ステップ2: Vault 作成（初回のみ）

1. **「Create」をタップ**
   ```
   初回起動時に「Create new vault」が表示される
   ```

2. **Vault 名を入力**
   ```
   例: "My Notes"
   ```

3. **保存先を選択**
   ```
   オプション:
   - Local on device: iPhone のローカルストレージ
   - iCloud Drive: iCloud 同期（複数デバイス間で自動同期）
   - OneDrive / Dropbox: クラウドストレージ（別途設定）
   ```

4. **「Create」をタップ**
   ```
   Vault が作成されます
   ```

---

## ステップ3: BRAT プラグイン追加

BRAT（Beta Reviewers Auto-update Tool）を使用することで、β版の Remote SSH を簡単にインストール・更新できます。

### 3.1 BRAT をコミュニティプラグインからインストール

1. **「Settings」をタップ**
   ```
   画面左下（iOS）または右上メニュー（iPad）
   ```

2. **「Community plugins」 → 「Browse」をタップ**
   ```
   Settings → Community plugins → Browse
   ```

3. **「BRAT」を検索**
   ```
   検索バー に "BRAT" 入力
   結果から「BRAT - Beta Reviewers Auto-update Tool」を選択
   ```

4. **「Install」をタップ**
   ```
   プラグインがダウンロード・インストール
   ```

5. **「Enable」をタップ**
   ```
   BRAT が有効化される
   ```

---

## ステップ4: Remote SSH β版をインストール

### 4.1 BRAT で β版リポジトリを追加

1. **「Settings」→「Community plugins」 → BRAT → 「Option」をタップ**
   ```
   BRAT の設定を開く
   ```

2. **「Add Beta plugin」をタップ**
   ```
   BRAT の Add Beta plugin オプションを実行
   ```

3. **リポジトリ URL を入力**
   ```
   https://github.com/lalate/obsidian-remote-ssh-gemini
   ```

4. **「Add」をタップ**
   ```
   β版チャンネルが登録される
   ```

### 4.2 Remote SSH をインストール

1. **「Community plugins」 → 「Browse」をタップ**
   ```
   Settings → Community plugins → Browse
   ```

2. **「Remote SSH」を検索**
   ```
   BRAT 経由で β版が検出可能になっています
   ```

3. **「Install」をタップ**
   ```
   プラグインがダウンロード・インストール
   ```

4. **「Enable」をタップ**
   ```
   Remote SSH が有効化される
   ```

---

## ステップ5: SSH プロファイル設定

### 5.1 SSH キーペア準備

Remote SSH では SSH 公開鍵認証を使用します。事前に SSH キーペアを準備してください。

**キーペア生成（macOS/Linux）:**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/obsidian_key -C "obsidian@iphone"
# または
ssh-keygen -t rsa -b 4096 -f ~/.ssh/obsidian_key -C "obsidian@iphone"
```

**公開鍵をサーバーに登録:**
```bash
cat ~/.ssh/obsidian_key.pub | ssh user@example.com "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**秘密鍵をコピー:**
```bash
# 次のステップで iPhone にインポートします
cat ~/.ssh/obsidian_key  # 内容を表示してコピー
```

### 5.2 iPhone での SSH プロファイル設定

1. **「Settings」をタップ**

2. **「Remote SSH」セクションを探す**
   ```
   Settings → 下部に「Remote SSH」がリスト表示
   ```

3. **「Add SSH Profile」をタップ**
   ```
   新しいプロファイルを作成
   ```

4. **プロファイル情報を入力**
   ```
   フィールド:
   - Profile name: "My Server" など自由な名前
   - Host: サーバーのホスト名または IP アドレス
     例: example.com または 192.168.1.100
   - Port: SSH ポート（通常 22）
   - Username: SSH ユーザー名
   - Authentication: "SSH Key" を選択
   - Private Key: 秘密鍵の内容をペースト
   - Vault Path: サーバー上の Vault ディレクトリ
     例: /home/user/my-vault
   ```

5. **「Save」をタップ**
   ```
   プロファイルが保存される
   ```

### 5.3 接続テスト

1. **プロファイルをタップ**
   ```
   保存したプロファイルを選択
   ```

2. **「Connect」をタップ**
   ```
   リモートサーバーに接続を試みる
   ```

3. **接続状態を確認**
   ```
   ✅ 接続成功: Vault が表示される
   ❌ 接続失敗: エラーメッセージを確認（後述のトラブルシューティング参照）
   ```

---

## ステップ6: リモート Vault 操作

### 基本操作

| 操作 | 説明 |
|------|------|
| **ファイル閲覧** | フォルダツリーからファイルをタップ → コンテンツ表示 |
| **ファイル編集** | ファイルを開く → 編集 → 自動保存（サーバーに反映） |
| **ファイル作成** | フォルダ > 「New Note」→ 名前入力 → 保存 |
| **ファイル削除** | ファイルを長押し → 「Delete」確認 |
| **フォルダ作成** | フォルダ操作メニュー → 「New Folder」 |

### iOS 固有の制限

| 制限 | 理由 | 代替手段 |
|------|------|--------|
| **バックグラウンド同期なし** | iOS制限 | フォアグラウンドで Obsidian を開いている間のみ同期 |
| **複数デバイス同時接続不可** | サーバー側の排他制御 | 接続を切断してから別デバイスで接続 |
| **大容量ファイル同期遅延** | ネットワーク帯域幅制限 | WiFi 環境での使用推奨 |

---

## ステップ7: Gemini CLI テンプレート設定（オプション）

Remote SSH に Gemini CLI 統合が含まれている場合、iOS でも以下の機能が使用可能です：

### Gemini コマンド

1. **「Gemini: Summarize selection」**
   - 選択したテキストを Gemini に要約させる
   - 結果を CLI 出力に表示

2. **「Gemini: Review selection」**
   - 選択したテキストをレビュー
   - 改善提案を出力

3. **「Gemini: Summarize current note」**
   - ノート全体を要約

### テンプレート カスタマイズ

1. **Settings → Remote SSH → Gemini セクション**

2. **3つのテンプレートそれぞれを編集**
   ```
   - Summarize selection template
   - Review selection template
   - Summarize note template
   ```

3. **テンプレート例（カスタマイズ）**
   ```
   "Extract the top 5 action items from the following note:"
   "Identify technical debt and propose refactorings for:"
   "Summarize in Japanese and highlight risks:"
   ```

---

## トラブルシューティング

### 接続エラー: "Connection refused"

**原因**: サーバー側の SSH ポートが閉じている、またはファイアウォール制限

**対策**:
```bash
# サーバー側で SSH デーモンが起動しているか確認
sudo systemctl status sshd

# ポート 22 がリッスン状態か確認
sudo ss -tlnp | grep 22

# 必要に応じて再起動
sudo systemctl restart sshd
```

### 接続エラー: "Authentication failed"

**原因**: SSH キーが正しくない、またはサーバー側に登録されていない

**対策**:
1. 秘密鍵の内容が正しくコピーされたか確認（改行含む）
2. サーバーの `~/.ssh/authorized_keys` に公開鍵が登録されているか確認
   ```bash
   cat ~/.ssh/authorized_keys
   ```

### ファイル同期が遅い

**原因**: ネットワーク接続が遅い、または大容量ファイル転送中

**対策**:
- WiFi 環境での接続を確認
- セルラーネットワークの場合は、より高速な接続に切り替え
- 大容量ファイル（>10MB）は PC から同期を推奨

### Vault が表示されない

**原因**: Vault Path が間違っているか、パーミッション不足

**対策**:
1. SSH で手動接続して Vault Path を確認
   ```bash
   ssh user@example.com
   ls -la /path/to/vault  # Vault パスが存在するか確認
   ```
2. パーミッション確認
   ```bash
   ls -ld /path/to/vault  # ユーザーに読み取り権限があるか確認
   ```

---

## パフォーマンス最適化

### 推奨設定

| 設定項目 | 推奨値 | 理由 |
|---------|--------|------|
| **ネットワーク** | WiFi 推奨 | セルラー使用時は通信量増加 |
| **Vault サイズ** | < 1000 ファイル | 同期時間短縮 |
| **ファイルサイズ** | < 10MB/ファイル | ストリーミング性能維持 |
| **接続時間** | 用途終了時に断切 | 電池消費抑制 |

### 推奨ワークフロー

```
1. WiFi 接続確認
2. Remote SSH を開く → Connect
3. 作業実施（編集・閲覧）
4. 編集完了後 → Disconnect
5. Obsidian をバックグラウンドから完全終了（電池節約）
```

---

## 既知の制限

| 機能 | デスクトップ版 | iOS版 | 備考 |
|------|--------|--------|------|
| **リモート編集** | ✅ | ✅ | SFTP 経由で実装 |
| **SSH CLI 実行** | ✅ | ❌ | iOS ネットワーク制限 |
| **バックグラウンド同期** | ✅ | ❌ | iOS 制限事項 |
| **複数同時接続** | ✅ | ⚠️ | 単一接続推奨 |
| **ローカルSSH daemon** | ✅ | ❌ | iOS 仕様上不可 |
| **Gemini CLI** | ✅ | ✅ | テンプレート設定可 |

---

## 次のステップ

- **フィードバック報告**: 不具合やアイデアは [GitHub Issues](https://github.com/lalate/obsidian-remote-ssh-gemini/issues) で報告してください
- **β版参加**: 新機能を試したい場合は BRAT で `next` ブランチをフォロー
- **コミュニティ**: [Obsidian Forum](https://forum.obsidian.md/) で相談・共有

---

## サポート

問題が発生した場合:

1. **このガイドのトラブルシューティングを確認**
2. **ログを確認**
   ```
   Settings → About → Show debug info → Logs
   ```
3. **GitHub Issues で検索**
   ```
   https://github.com/lalate/obsidian-remote-ssh-gemini/issues
   ```
4. **新規 Issue を作成**（解決しない場合）
   ```
   - iOS デバイス情報（機種、OS バージョン）
   - エラーメッセージ全文
   - 再現手順
   ```
