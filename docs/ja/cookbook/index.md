---
title: Cookbook
lang: ja
tags: [cookbook, how-to]
---

# Cookbook

ドキュメント全体のパーツを組み合わせた、目的指向のウォークスルー集です。「X したい」という質問にステップバイステップで答えるなら、ここから始めてください。

## レシピ

| 目的 | ページ |
|---|---|
| Pi を自宅 vault サーバとしてセットアップ（ゼロ → 初回接続） | [[ja/cookbook/raspberry-pi-vault\|Raspberry Pi vault from scratch]] |
| プラグイン用の SSH 鍵を生成 | [[en/cookbook/ssh-keygen\|SSH 鍵の生成]]（英語） |
| Pi 上の vault を Tailscale 経由で同僚と共有 | [[en/cookbook/share-via-tailscale\|Tailscale 経由で共有]]（英語） |
| 自動デプロイされるデーモンを systemd 管理に置き換え + cosign 検証 | [[en/cookbook/systemd-managed-daemon\|systemd-managed daemon]]（英語） |
| vault バックアップ（rsync / restic / borg）+ ディスク障害 / 誤削除からの復旧 | [[en/cookbook/backup-restore\|Backup & restore]]（英語） |
| vault をホスト間で移行（Pi → NAS、自宅 → VPS など） | [[en/cookbook/host-migration\|Migrating between hosts]]（英語） |
| YubiKey / TouchID / Windows Hello で SSH 接続を署名 | [[en/cookbook/hardware-key\|Hardware-key SSH auth]]（英語） |
| Docker sshd の前段に nginx / Caddy / SSH ProxyJump | [[en/cookbook/reverse-proxy\|Reverse proxy in front of Docker sshd]]（英語） |
| 仕事 + 個人 + 家族の vault を 1 つの Obsidian インストールから編集 | [[en/cookbook/multi-vault\|Editing multiple vaults from one Obsidian]]（英語） |

このページにないレシピが欲しい場合は [discussion](https://github.com/sotashimozono/obsidian-remote-ssh/discussions) を立ててください — 共通の要望はレシピ化されます。
