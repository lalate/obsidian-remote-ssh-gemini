---
title: Performance tuning
tags: [operations, performance]
---

# Performance tuning

A consolidated guide to making the plugin feel snappy. Information here is scattered across `troubleshooting`, `raspberry-pi`, and `architecture/perf` — this page is the one place to start when "things feel slow".

## Where time actually goes

```mermaid
flowchart LR
  A[Obsidian action<br/>e.g. open file] --> B[Plugin issues fs.readText]
  B --> C[JSON serialise + frame]
  C --> D[SSH transport: laptop → remote]
  D --> E[Daemon parses + dispatches]
  E --> F[Remote disk I/O]
  F --> G[Daemon serialises response]
  G --> H[SSH transport: remote → laptop]
  H --> I[Plugin parses + materialises]
  I --> J[Obsidian renders]
```

For a typical small note (~5 KB):

| Stage | Typical cost |
|---|---|
| Plugin → JSON-RPC encode | < 1 ms |
| SSH RTT (LAN) | 0.5–2 ms |
| SSH RTT (home WAN) | 5–30 ms |
| SSH RTT (cross-continent) | 50–200 ms |
| Daemon dispatch + read | 1–10 ms |
| Plugin decode + Obsidian render | 1–5 ms |

**The dominant factor is SSH RTT.** Everything below tunes around that reality.

## Diagnose first

Before tuning, measure. Two commands answer 90% of "why is it slow":

```bash
# 1. Network RTT to the remote
ping -c 5 your-host
# → look at the avg; that's your floor for every RPC

# 2. Cold fs.walk time on the actual vault
ssh user@host 'time find ~/notes -type f | wc -l'
# → first run = cold-cache; second run = warm-cache (Linux page cache)
# Big delta between cold and warm means disk-I/O-bound on this host
```

If `ping` is > 50 ms, that's your problem; skip to [Network section](#network). If cold `find` is > 5 seconds for a < 10k-file vault, that's disk-bound; skip to [Disk section](#disk-on-the-remote).

## Network

### High SSH RTT — the universal problem

The plugin makes **many small RPCs** during normal Obsidian use (file open = fs.stat + fs.readText; saving = fs.write; switching folders = fs.list). At 50 ms RTT, ten ops in a flow ≈ half a second of accumulated wait.

What helps:

- **Use Tailscale or another mesh VPN** rather than going over the open internet. Tailscale's direct UDP path is typically 10-30 % faster than relayed TCP. See [[en/cookbook/share-via-tailscale|Tailscale recipe]].
- **Use a closer remote** if you're on a long-haul setup. A Pi at home (5-30 ms) beats a VPS in another continent (100-200 ms) for daily editing.
- **Don't use ssh-over-WebSocket-over-TLS** unless you must — every wrapper adds RTT.

### Throughput vs latency

Throughput rarely bottlenecks for note-editing — even a 10 Mbit/s link handles thousands of small RPCs per second. The exception:

- **Large attachments / images** (10+ MB) — limited by raw bandwidth + base64 overhead. The plugin uses `fs.readBinaryRange` for partial reads (e.g. image previews), but the first full open of a big binary spends real bandwidth.
- **Initial `fs.walk` on a huge vault** — recursive walk emits one entry per file in a single response. 100k files = significant payload. Mitigated by `maxEntries` cap; the plugin sets a sane default.

### SSH-level tuning

```
# In ~/.ssh/config or /etc/ssh/ssh_config on the laptop
Host your-host
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m
  TCPKeepAlive yes
  ServerAliveInterval 60
```

`ControlMaster` reuses one TCP connection across multiple SSH invocations, which avoids the TCP+SSH-handshake cost on reconnect. Note: the plugin manages its own connection lifecycle, so this primarily helps if you also use `ssh user@host` from the terminal.

## Disk on the remote

### Vault on SD card vs SSD

For a Raspberry Pi (or anything else with slow storage):

| Storage | First fs.walk on 10k files | Subsequent (cached) |
|---|---|---|
| Pi SD card (Class 10) | 5-15 s | 0.2-0.5 s |
| Pi USB-attached SATA SSD | 0.5-1.5 s | 0.1-0.3 s |
| NVMe SSD | < 0.5 s | < 0.1 s |

Cold-cache reads dominate first-time-of-day vault use. **The single biggest improvement on a Pi is moving the vault off the SD card to a USB-attached SSD.** Even a cheap $20 240 GB SATA SSD with a USB-3 enclosure is dramatic.

### Filesystem choice

ext4 / btrfs / xfs all work. Notes:

- **ZFS on top of single-disk consumer storage** can add unexpected latency for many-small-file workloads. If you're on ZFS, set `recordsize=16K` on the dataset holding the vault.
- **NFS mounts** as the vault root work but add a layer of latency; keep the daemon close to the actual filesystem, not over NFS to elsewhere.
- **encrypted-at-rest filesystems** (LUKS, FileVault) have negligible per-op overhead in modern CPUs.

## inotify limits (Linux remotes)

The daemon uses `fsnotify` (which uses inotify on Linux) to watch the vault. Linux has a per-user limit on how many directories one process can watch, defaulting to 8192 on most distros — fine for a small vault, problematic for big trees.

Symptom of hitting the limit: remote edits do not appear locally until you switch focus or trigger a manual refresh.

```bash
# Check the limit
cat /proc/sys/fs/inotify/max_user_watches

# Bump it (active until reboot)
sudo sysctl -w fs.inotify.max_user_watches=65536

# Persist across reboots
echo 'fs.inotify.max_user_watches=65536' | \
  sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl --system
```

65536 covers vaults up to ~50k directories comfortably. Bumping further has memory cost (~1 KiB per watch).

## Plugin / client side

### Reduce reconnect-storm thrash

If your network is flaky, the reconnect manager retries up to 5 times with ×1.5 backoff (1 s, 1.5 s, 2.25 s, …). On a poor link, you might hit the cap quickly.

In **Settings → Advanced**:
- Bump **Reconnect attempts** from 5 to 10 if you genuinely have flaky connectivity (most users don't need this)
- Disable auto-reconnect (set to 0) only if you'd rather see drops as errors than wait through retries

### Daemon panel: Restart instead of Reconnect

If only one operation is slow and reconnecting doesn't help, the plugin's local state may be inconsistent (e.g. stale fs.watch subscription). Settings → Daemon → **Restart** rebuilds everything cleanly. ~5 s downtime.

### Telemetry to spot regressions

Enable [[en/configuration/advanced|Telemetry]] when something gets newly slow. The error category counts will surface whether you're seeing more `connect.fail.timeout`, `rpc.fail.PreconditionFailed` (= conflict thrash), or general `reconnect.attempting` events. This data is local-only.

## Daemon-side: thumbnail cache

The daemon has a server-side thumbnail cache for `fs.thumbnail` calls (default 200 MB, under `~/.obsidian-remote/cache/thumbs/`). For an image-heavy vault, this dramatically reduces repeated-resize work. It's enabled by default; not a tuning knob you usually touch.

If you see disk pressure from this cache, the cleanest mitigation is to mount `~/.obsidian-remote/cache/` on tmpfs (cache regenerates on demand):

```
# /etc/fstab fragment (Linux, optional)
tmpfs  /home/USER/.obsidian-remote/cache  tmpfs  size=512M,mode=0700,uid=USER,gid=USER  0 0
```

## Reasonable expectations

| Setup | Per-op feel |
|---|---|
| Pi 4 + USB SSD + LAN | Indistinguishable from local-vault Obsidian |
| Pi 4 + SD card + LAN | Snappy after warm-up; first cold load ~5 s |
| VPS in same continent + Tailscale | Slight lag on big-folder switches; otherwise fine |
| VPS cross-continent + open internet | Noticeable per-op pause; livable for editing-focused use, less great for "browse everything" workflows |
| Pi Zero 2 W + SD card | Acceptable for small vaults; struggles past ~5k files |

If your feel is significantly worse than the row matching your setup, something's off — file an [issue](https://github.com/sotashimozono/obsidian-remote-ssh/issues) with the diagnostic numbers above.

## See also

- [[en/architecture/perf|Performance architecture]] — internals + the perf bench that gates regressions
- [[en/operations/troubleshooting|Troubleshooting]] — the broader issue tree (this page is the perf branch)
- [[en/server/raspberry-pi|Raspberry Pi notes]] — Pi-specific perf footnotes
- [[en/api/watch|fs.watch]] — inotify limits in the wire-protocol context
