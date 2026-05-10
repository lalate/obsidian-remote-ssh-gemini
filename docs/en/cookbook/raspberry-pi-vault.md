---
title: Raspberry Pi vault from scratch
tags: [cookbook, how-to, raspberry-pi]
description: "Set up a Raspberry Pi as your home Obsidian vault server from scratch — OS install, SSH key, vault directory, network access, and the matching plugin profile."
schema: Article
---

# Raspberry Pi vault from scratch

Goal: a Pi running on your home network that hosts your Obsidian vault, accessed from your laptop via this plugin. About 30 minutes including the Pi OS install.

## Hardware + OS

- Pi 4 / Pi 5 (4 GB RAM is plenty). Pi Zero 2 W works for small vaults.
- 32 GB+ microSD or (better) a USB-attached SSD.
- Raspberry Pi OS (Bookworm) or Ubuntu Server 22.04+ for arm64.

Flash with [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Under the gear icon, set:

- Hostname: `obsidian-vault.local` (anything; pick something memorable)
- Enable SSH: yes, with public-key auth using your existing public key
- Wi-Fi credentials (or wire it ethernet)

Boot the Pi, wait ~60 seconds.

## First connect from your laptop

Verify SSH works from your normal terminal first:
```bash
ssh pi@obsidian-vault.local
```

If that's good, you're done with Pi setup — the plugin needs nothing else on the remote yet. Make a vault directory:
```bash
ssh pi@obsidian-vault.local 'mkdir -p ~/notes'
```

## Add the profile in the plugin

**Settings** → **Remote SSH** → **Add profile**:

| Field | Value |
|---|---|
| Profile name | `Pi vault` |
| Host | `obsidian-vault.local` (or the Pi's IP) |
| Port | `22` |
| Username | `pi` |
| Authentication | `SSH agent` (recommended) or your private key path |
| Remote vault path | `/home/pi/notes` (or `~/notes`) |
| Mode | `Daemon (deploys helper on connect)` (lower latency than the SFTP default) |

Click **Save**, then connect from the command palette: "Remote SSH: Connect" → pick `Pi vault`.

The plugin uploads the daemon binary (~5 MB), starts it, opens a shadow vault window. First connect ~5–8 s; subsequent connects ~1 s.

## Make the daemon outlive plugin reconnects

Optional, but worth it for a Pi you'll keep on 24/7. Put the daemon under systemd so it survives plugin restarts and Pi reboots — see [[en/cookbook/systemd-managed-daemon|systemd-managed daemon]].

## Check it's working from the other side

Edit a note in Obsidian, then on the Pi:
```bash
ls -lt ~/notes | head
```

Your latest edit should be on top with a recent mtime.

## See also

- [[en/server/raspberry-pi|Server / Raspberry Pi notes]] — performance ceilings per Pi model + tuning notes
- [[en/operations/troubleshooting|Troubleshooting]] — what to check if first connect fails
- [[en/cookbook/ssh-keygen|Generating an SSH key]] — if `ssh pi@obsidian-vault.local` asked for a password
