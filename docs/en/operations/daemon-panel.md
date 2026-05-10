---
title: Daemon panel
tags: [operations]
---

# Daemon panel

A status panel that appears in **Settings** when an RPC profile has an active daemon.

## What it shows

- **Status badge**: "Running" (green) / "Down" (red).
- **Version**: daemon binary version (`server.info.version`).
- **Capabilities**: count + list of supported `fs.*` methods. Useful when the plugin and daemon disagree about whether a feature exists.
- **Connected since**: when the current session was established.
- **Last log line**: most recent line from `server.log` for quick check.

## Actions

| Button | What it does |
|---|---|
| **Restart** | Closes any open shadow vaults for this profile, kills the daemon, re-deploys (uploads + verifies + spawns), opens a fresh session. Asks for confirmation first. |
| **View log** | Opens a modal showing the last 50 lines of `~/.obsidian-remote/server.log`. Refresh button re-fetches. |
| **Disconnect** | Tears down the SSH session and closes shadow vaults, but leaves the daemon running on the remote (so a quick reconnect skips the binary re-upload). |

## When to restart

- After upgrading the plugin (the bundled daemon binary may have changed).
- After changing transport settings (socket path, token path).
- If the daemon log shows a fatal error (`vault root removed`, etc.).
- For diagnostic reset when something feels stuck.

Restart takes ~5 seconds: kill (1s), upload skip if hash matches (else 2-3s), verify (instant), spawn (1s), token poll + reconnect (1s).

## When NOT to restart

- Conflicts with another user's edit — restart won't help; resolve via the diff view (see [[en/user-guide/conflicts|Conflict handling]]).
- Slow performance — restart won't help unless the daemon itself is wedged. Check `inotify` limits, disk speed, network RTT first (see [[en/operations/troubleshooting|Troubleshooting]]).

Next: [[en/faq|FAQ]].
