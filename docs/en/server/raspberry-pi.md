---
title: Raspberry Pi
tags: [server, deploy, raspberry-pi]
---

# Raspberry Pi notes

obsidian-remote-ssh runs comfortably on Raspberry Pi 4 / 5 / Zero 2 W. The daemon is a single Go binary — no runtime deps beyond the Linux kernel + glibc.

## Recommended setup

- Raspberry Pi OS (Bookworm) or Ubuntu Server 22.04+ for arm64.
- SSH enabled (`raspi-config` → Interface Options → SSH).
- Your public key in `~/.ssh/authorized_keys` on the Pi.
- A vault directory: `mkdir ~/notes`.

## First-time install

Just connect via the plugin — the [[en/server/auto-deploy|auto-deploy]] uploads the right binary (`obsidian-remote-server-linux-arm64`) and starts it.

## Performance notes

| Pi model | Vault size handled comfortably | Notes |
|---|---|---|
| Pi 5 | 100k+ files, multi-GB | Effortless. Use this for a "primary" home vault. |
| Pi 4 (4–8 GB) | ~30k files, 1–2 GB | Excellent — the sweet spot for most users. |
| Pi 3B+ | ~10k files | OK for moderate vaults; SD card I/O is the bottleneck. |
| Pi Zero 2 W | ~5k files | Works; expect 100–200 ms RPC latency. |

The daemon idles at ~5 MB RSS. Watcher subscriptions add ~50–100 KB each. Concurrent reads/writes spike CPU briefly but the steady state is near-zero.

## SD card vs SSD

Vault on SD card: fine, but `fs.walk` on a large vault can take 5–10s on the first cold-cache call. Vault on a USB-attached SSD: ~10× faster cold reads, much better for vaults > 5k files.

## Long-lived daemon

The plugin's auto-deploy kills + restarts the daemon on every connect. For a Pi you'll keep on 24/7, run the daemon under [[en/server/systemd|systemd]] so it survives plugin reconnects and reboots.

## Cooling / throttling

Sustained `fs.walk` on a large vault, with no heatsink on a Pi 4, will throttle. Add a basic heatsink — the daemon stays out of throttle thereafter.

## Headless mode

Many Pi setups have no monitor attached. SSH all the way:

```bash
sudo loginctl enable-linger $USER       # services survive logout
systemctl --user enable --now obsidian-remote-server   # see [[en/server/systemd|systemd]]
```

Next: [[en/server/signing|Binary signing]].
