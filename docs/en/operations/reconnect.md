---
title: Reconnect behavior
tags: [operations]
---

# Reconnect behavior

When the SSH connection drops mid-session (network blip, sleep/wake, Wi-Fi roam), the plugin tries to recover automatically before surfacing an error to you.

## Default policy

- **Trigger**: any RPC call that fails with a transport-layer error (broken pipe, EOF, connection reset).
- **Retries**: 5 (configurable: **Settings** → **Advanced** → **Reconnect attempts**).
- **Backoff**: exponential — 1s, 2s, 4s, 8s, 16s. Capped at 30s per attempt.
- **What's reused**: the daemon. The plugin re-opens the SSH session and the local TCP forward, then re-`auth`s and re-subscribes to any active watchers.

## What you'll see

A subtle banner appears at the bottom of the workspace:

```
Reconnecting to "My Pi" (attempt 2/5)…
```

- Within 5–10 seconds (typical home WiFi blip): banner disappears, life continues.
- After all retries exhausted: banner becomes red — "Disconnected from My Pi", with a "Retry" button. The shadow vault stays open so you don't lose unsaved work; writes queue locally and flush on next connect.

## What about the daemon

The daemon stays running. If the SSH session is the only thing that died (kernel didn't kill the daemon), reconnect is fast — same daemon, same socket, same token. If the OS rebooted between drops, the daemon is gone too; the plugin re-deploys it as part of the reconnect attempt (~5 seconds).

## Disabling auto-reconnect

Set **Reconnect attempts** to `0` in advanced settings. Drops will surface immediately as errors. Useful if you're debugging a flapping link and want raw signal.

## Mobile / sleep behavior

When your laptop sleeps, the SSH session stays "open" from your end's perspective — the kernel doesn't actively close it. On wake, the first RPC will hang for whatever your TCP keepalive is configured to, then fail with a broken pipe. The reconnect kicks in then.

For long sleeps (overnight), this often means a 30–60 second wait on first interaction after wake. To shorten: enable TCP keepalive on the remote sshd (`ClientAliveInterval 60` in `sshd_config`).

## Watcher resubscription

After reconnect, the plugin re-issues any active `fs.watch` calls. Events that fired during the disconnect window are NOT replayed — the plugin instead does a one-shot `fs.walk` to compare and surface anything that changed. This catches "I edited a file on the remote while my laptop was asleep".

For very long disconnects (hours), the comparison is bounded by `maxEntries` (default 50,000). If you exceed it, the plugin shows a notice and offers a manual "rescan vault" action.

Next: [[en/operations/daemon-panel|Daemon panel]].
