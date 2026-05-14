# β Testing Program & External Tester Recruitment

## 概要

iOS や新機能をテストしていただく外部テスターの募集・管理プロセスを体系化します。段階的にテストを進め、フィードバックを収集・改善してから、本家への pull request や public release へ進めます。

---

## テスト段階

### Stage 1: Internal Testing (現在 ← あなた)

**実施者**: 開発チーム（自分）  
**対象**: フォーク版 `feat/gemini-cli-integration`  
**スコープ**: 単体テスト → 統合テスト → e2e テスト  
**期限**: 機能の実装と安定性が目安

**チェックリスト**:
- [ ] 型安全性と構文チェック (`tsc --noEmit`, `npm test`)
- [ ] サーバー側テスト (`go test ./...`)
- [ ] Gemini CLI 統合テスト (ローカル)
- [ ] iOS manifest/ビルド設定検証
- [ ] iOS でのビルド可能性確認

### Stage 2: β Testing (次のフェーズ)

**実施者**: 外部ボランティアテスター（1〜3 名）  
**対象**: fork 版、または beta タグ付きリリース  
**スコープ**: 実機テスト（iPhone/iPad）+ フィードバック収集  
**期限**: 主要な問題がフィックスされ、ドキュメント完成後

**必要な準備**:
- [ ] iOS セットアップガイド完成
- [ ] BRAT β チャンネル動作確認
- [ ] β テスター募集メッセージ作成
- [ ] フィードバック収集フォーム準備

### Stage 3: Public Release (その後)

**対象**: 本家 (`sotashimozono/obsidian-remote-ssh`) または Community Plugins  
**スコープ**: 広く利用可能  
**期限**: β テスター フィードバック対応完了後

---

## β テスター募集フロー

### 1. テスター対象の定義

#### 求める人物像

```
✅ 理想的な β テスター:
- Obsidian 経験者（基本的な操作は自分で調べられる）
- iOS Obsidian ユーザー
- SSH/リモート接続に最低限の知識がある
- フィードバック報告を丁寧に行える
- 英語または日本語でコミュニケーション可能

❌ 除外条件:
- サポート対応を期待している人
- 緊急バグ修正を期待している人
- 複数同時接続など未実装機能を求めている人
```

#### テスター数

```
推奨:
- Stage 2a (Early): 1〜2 名（信頼できる人）
- Stage 2b (Extended): 3〜5 名（さらに多角的視点）
```

### 2. テスター募集

#### 募集チャネル

| チャネル | 用途 | 告知内容 |
|---------|------|---------|
| **GitHub Discussions** | 技術者向け | 実装詳細とリンク |
| **Obsidian Forum** | 一般ユーザー向け | 簡潔に「iOS テスター募集」 |
| **Twitter/X** | 広告枠として | 機能デモ + リンク |
| **個人ネットワーク** | 信頼できる人 | 直接招待 |

#### 募集テンプレート（日本語）

```markdown
# iOS Remote SSH β テスター募集

Remote SSH プラグインが **iOS/iPadOS** に対応しました。
実機テストにご協力いただけるテスターを募集しています。

## 対象者

- Obsidian iOS ユーザー
- SSH/リモートサーバーの基本知識がある方
- 実機でのテストフィードバックが可能な方

## 期間

- **申し込み期限**: 2026/5/30
- **テスト期間**: 2026/6/1 〜 2026/6/30
- **報告期限**: 2026/7/5

## セットアップ

BRAT を使用して自動セットアップ。詳細は 
[iOS Setup Guide](docs/en/getting-started/ios-setup.md) を参照してください。

## フィードバック方法

- **問題報告**: GitHub Issues のテンプレート使用
- **改善提案**: Discussions で議論
- **成功事例**: Testimonials フォームで共有

## 特典

- ❤️ リリースノートにテスター名記載（希望者のみ）
- 📬 新機能の先行体験
- 🎁 プラグイン開発への貢献実績

**応募方法**: このコメント欄で「参加します」またはメール送信

---

詳細: [BRAT Testing Plan](reference/BRAT-testing-plan.md)
```

#### 募集テンプレート（English）

```markdown
# Remote SSH iOS β Testers Wanted

Remote SSH now supports **iOS/iPadOS**. We're recruiting beta testers 
for hands-on device testing and feedback.

## Qualifications

- Active Obsidian iOS user
- Basic SSH/remote server knowledge
- Ability to provide detailed feedback over 4 weeks

## Timeline

- **Signup deadline**: May 30, 2026
- **Testing period**: June 1 — June 30, 2026
- **Feedback deadline**: July 5, 2026

## Getting Started

Auto-setup via BRAT. See [iOS Setup Guide](docs/en/getting-started/ios-setup.md).

## Report Issues

- **Bugs**: GitHub Issues (template provided)
- **Suggestions**: Discussions
- **Success stories**: Testimonials form

## Perks

- ❤️ Your name in release notes (opt-in)
- 📬 Early access to new features
- 🎁 Contributor recognition

**Sign up**: Reply here or email contact

---

See [BRAT Testing Plan](reference/BRAT-testing-plan.md) for details.
```

### 3. テスター確認と環境整備

#### テスター引き受け確認メール

```markdown
Subject: Remote SSH iOS β Tester — Welcome

Hi [Tester Name],

Thank you for volunteering! Here's your tester package:

### Phase 1: Environment Setup (by June 1)
1. Review: [iOS Setup Guide](docs/en/getting-started/ios-setup.md)
2. Ensure you have:
   - Obsidian iOS (v1.5+)
   - BRAT plugin installed
   - SSH access to a remote server

### Phase 2: Initial Testing (June 1 — 10)
- Follow setup steps
- Report any blockers in GitHub Issues

### Phase 3: Active Testing (June 10 — 30)
- Use Remote SSH for your daily work (if applicable)
- Document issues / edge cases
- Share ideas via Discussions

### Phase 4: Wrap-up (July 1 — 5)
- Final feedback report
- Optional: Testimonial for release notes

### Communication

- **Issues**: GitHub Issues (#ios-feedback tag)
- **Questions**: GitHub Discussions
- **Direct**: [Your contact email]

### Feedback Template (GitHub Issues)

```
### Device Info
- iPhone 14 Pro / iOS 17.5
- Obsidian v1.5.3
- Remote SSH v1.1.0-beta.1

### Scenario
[Describe what you were trying to do]

### Expected
[What should have happened]

### Actual
[What actually happened]

### Logs
[Paste debug info: Settings → About → Show debug info]

### Workaround
[If you found one]
```

### Privacy & Feedback License

Your feedback may be shared anonymously in release notes or docs.
By participating, you grant us permission to use your feedback.

[Accept] [Decline]

---

Thanks again! We're excited to have you on the team.

—The Remote SSH Team
```

---

## フィードバック収集・管理

### Issue Template for β Testers

**GitHub Issues に専用テンプレートを作成:**

`.github/ISSUE_TEMPLATE/ios-beta-feedback.md`

```markdown
---
name: "iOS β Feedback"
about: Report issues or feedback from iOS testing
labels: ios, beta-feedback
---

## Device & Environment

- **Device**: iPhone 14 Pro / iPad Air
- **iOS Version**: 17.5
- **Obsidian Version**: 1.5.3
- **Remote SSH Version**: 1.1.0-beta.1 (or commit hash)

## Category

- [ ] Bug / Crash
- [ ] Performance
- [ ] UI/UX
- [ ] Feature Request
- [ ] Documentation

## Description

[Describe the issue]

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

[What should happen]

## Actual Behavior

[What actually happens]

## Screenshots/Video

[Attach if applicable]

## Debug Info

[Output from: Settings → About → Show debug info → Copy]

## System Details

- SSH Connection: [Hostname / Protocol]
- Vault Size: [Approx # of files]
- Network: [WiFi / Cellular]

## Additional Notes

[Any workarounds, severity assessment, etc.]

---

Thank you for testing!
```

### Feedback Triage Board

Discussions で意見・提案を整理:

```
# iOS Testing Feedback Board

## 🆕 New Reports
[Unreviewed feedback]

## 🔴 Critical Bugs
[Blocking issues]

## 🟡 Moderate Issues
[Non-blocking issues]

## 🟢 Resolved
[Fixed issues waiting for tester confirmation]

## 💡 Feature Ideas
[Collected requests for future phases]
```

---

## テスト実行スケジュール（例）

```
Week 1 (Jun 1 — 7)
├─ テスター環境セットアップ確認
├─ 基本フロー（接続→編集→保存）テスト
└─ 初期問題報告

Week 2 (Jun 8 — 14)
├─ エッジケーステスト（大容量ファイル、複数接続）
├─ ネットワーク不安定環境テスト
└─ Gemini CLI 機能テスト

Week 3 (Jun 15 — 21)
├─ Bug fix 確認
├─ パフォーマンス測定
└─ ドキュメント精度確認

Week 4 (Jun 22 — 30)
├─ 回帰テスト
├─ 最終フィードバック収集
└─ Release Notes 作成

Post-testing (Jul 1 — 5)
├─ Tester testimonials 収集
├─ Known Issues リスト作成
└─ Public Release 準備
```

---

## フィードバックの優先順位付け

### Severity Matrix

|  | High Impact | Medium Impact | Low Impact |
|---|---|---|---|
| **High Likelihood** | 🔴 Critical | 🟡 Major | 🟢 Minor |
| **Medium Likelihood** | 🟡 Major | 🟡 Major | 🔵 Enhancement |
| **Low Likelihood** | 🟡 Major | 🟢 Minor | 🔵 Enhancement |

### 対応ルール

- **🔴 Critical** → 即座に fix（リリース前必須）
- **🟡 Major** → 対応or Known Issues 記載（リリース可）
- **🟢 Minor** → 次のマイナーバージョンで対応
- **🔵 Enhancement** → バックログに格納

---

## Release Notes への反映

### β Testers 謝辞セクション

```markdown
## Thanks to Our β Testers

We'd like to extend our gratitude to the following community members
for their invaluable testing and feedback on iOS support:

- 🎉 [Tester 1 Name] — iOS setup & BRAT testing
- 🎉 [Tester 2 Name] — Edge case discovery
- 🎉 [Tester 3 Name] — Performance profiling

Your contributions directly shaped v1.1.0's iOS experience!
```

### Known Limitations セクション

```markdown
## Known Limitations (iOS)

- Background sync not supported (iOS App Lifecycle restrictions)
- CLI command execution limited to foreground session
- [See full list](docs/en/getting-started/ios-setup.md#known-limitations)
```

---

## 外部テスター以降のプロセス

### From β to Public Release

```
Stage 2 (β)
├─ Internal testing & tester feedback (4 weeks)
└─ Fix critical/major issues

↓

Stage 3a (Candidate Release)
├─ Create RC tag (v1.1.0-rc.1)
├─ Build & sign daemon binaries
└─ Final QA by internal team

↓

Stage 3b (Public Release)
├─ Create GitHub Release with release notes
├─ Announce on Obsidian Forum / Twitter
├─ Submit to Community Plugins (if eligible)
└─ BRAT subscribers auto-update

↓

Post-Release (Maintenance)
├─ Monitor GitHub Issues for blockers
├─ Plan v1.1.1 patch releases if needed
└─ Collect feedback for v1.2 roadmap
```

---

## Communication Template Summary

### ✉️ Initial Recruitment Email

```
Subject: You're invited: Remote SSH iOS β Testing Program

Hi [Name],

We're launching iOS support for Remote SSH and would love your help!

[Recruitment template text above]
```

### ✉️ Acceptance Email

```
Subject: Welcome to the iOS β Testing Program!

Hi [Name],

Thanks for joining! Here's your tester kit: [Welcome package above]
```

### 📋 Weekly Check-in

```
Subject: iOS Testing Week [N] — Check-in

Hi All,

This week we're focusing on [focus area].
Please report findings in [GitHub Issues / Discussions].

[Specific test scenarios]

Questions? Reply here or see [iOS Setup Guide link].
```

### ✅ Closing Thank You

```
Subject: Thank you for your iOS testing contribution!

Hi [Name],

The β testing program has concluded. We've incorporated your feedback
and are preparing for public release.

[Testimonial request if opted-in]

See the v1.1.0 release notes: [link] for credits.
```

---

## チェックリスト: β Testing Program 始める前に

- [ ] iOS Setup Guide 完成
- [ ] BRAT β チャンネル動作確認
- [ ] Testers 募集テキスト作成（日本語/English）
- [ ] GitHub Issues テンプレート作成
- [ ] Discussions カテゴリ作成（iOS Feedback）
- [ ] GitHub Actions / CI で iOS ビルド検証設定
- [ ] Known Issues リスト準備
- [ ] Release Notes テンプレート準備
- [ ] 自分での内部テスト完了（Stage 1）

---

## 参考資料

- [iOS Setup Guide](docs/en/getting-started/ios-setup.md)
- [BRAT Testing Plan](reference/BRAT-testing-plan.md)
- [Beta Version Management](plugin/scripts/bump-version.mjs)
