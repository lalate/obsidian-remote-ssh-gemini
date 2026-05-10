---
title: Cookbook
tags: [cookbook, how-to]
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

If you want a recipe that's not here, open a [discussion](https://github.com/sotashimozono/obsidian-remote-ssh/discussions) — common asks become recipes.
