---
title: Cookbook
tags: [cookbook, how-to]
description: "Goal-oriented walkthroughs for obsidian-remote-ssh: Raspberry Pi vault, Tailscale, hardware keys, backups, host migration, multi-vault, systemd, reverse proxy."
---

# Cookbook

Goal-oriented walkthroughs that compose pieces from the rest of these docs. If you want a step-by-step "how do I…" answer, start here.

## Recipes

| Goal | Page |
|---|---|
| Set up a Pi as your home vault server (zero to first connect) | [[en/cookbook/raspberry-pi-vault\|Raspberry Pi vault from scratch]] |
| Generate an SSH key the plugin can use | [[en/cookbook/ssh-keygen\|Generating an SSH key]] |
| Edit your vault from a Pi while a colleague edits via Tailscale | [[en/cookbook/share-via-tailscale\|Share a vault via Tailscale]] |
| Replace the auto-deployed daemon with a systemd-managed one + cosign-verify it | [[en/cookbook/systemd-managed-daemon\|systemd-managed daemon]] |
| Back up your vault (rsync / restic / borg) + restore from disk failure or accidental delete | [[en/cookbook/backup-restore\|Backup & restore]] |
| Move your vault from one remote host to another (Pi → NAS, home → VPS, etc.) | [[en/cookbook/host-migration\|Migrating between hosts]] |
| Use a YubiKey / TouchID / Windows Hello to sign SSH connections | [[en/cookbook/hardware-key\|Hardware-key SSH auth]] |
| Front the Docker sshd with nginx / Caddy / SSH ProxyJump | [[en/cookbook/reverse-proxy\|Reverse proxy in front of Docker sshd]] |
| Edit work + personal + family vaults from one Obsidian install | [[en/cookbook/multi-vault\|Editing multiple vaults from one Obsidian]] |

If you want a recipe that's not here, open a [discussion](https://github.com/sotashimozono/obsidian-remote-ssh/discussions) — common asks become recipes.
