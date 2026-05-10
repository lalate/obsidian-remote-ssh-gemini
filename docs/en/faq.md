---
title: FAQ
tags: [faq]
---

# FAQ

Recurring questions, with the shortest useful answer.

## How is this different from Obsidian Sync, Syncthing, or Dropbox?

| | obsidian-remote-ssh | Obsidian Sync | Syncthing / Dropbox |
|---|---|---|---|
| Where files live | One canonical copy on YOUR remote host | Cloud (Obsidian's servers) | Replicated across all your devices |
| Auth | Your SSH keys | Obsidian account | Service account |
| Conflict model | mtime preconditions; daemon-mediated | Vector clock; cloud-mediated | File-modified-time; risk of `*-conflict-...` files |
| What if the cloud goes down | N/A — there is no cloud | Vault inaccessible until restored | Local copy still usable |
| Cost | Self-hosted (free) | Subscription | Free tier varies |
| Mobile | Not yet | Yes | Yes (limited Android sandbox) |

The right pick depends on your trust model + ops appetite. If you already have a server you trust and do not want a third-party cloud in the loop, this plugin is for you.

For an expanded breakdown that also covers Obsidian Git, Nextcloud, and the [Remotely Save](https://github.com/remotely-save/remotely-save) plugin, see [[en/comparison|the full comparison page]].

## Does it work on mobile?

Not yet. Tracked under [the mobile-relay milestone](https://github.com/sotashimozono/obsidian-remote-ssh/issues?q=label%3Amobile). The current architecture spawns a daemon binary on the remote, which works fine on a desktop where Obsidian is Electron. Mobile (iOS / Android Obsidian) needs a relay component because the OS does not allow Obsidian to spawn arbitrary subprocesses.

## Can I use this with multiple clients editing the same vault?

Yes — designed for it. Each client gets its own shadow vault and its own daemon session. Conflicts surface via the [[en/user-guide/conflicts|conflict handling]] flow.

The known sharp edge: workspace state (open tabs, pane sizes) is per-client, stored under `.obsidian/user/<client-id>/`. Some plugins put workspace-like state in the main `.obsidian/workspace.json` instead, and those still race. We do not have a good fix yet — open an issue if you hit this.

## Does it support Windows / Linux / macOS as the LOCAL machine?

Yes, all three. Local OS is just where Obsidian runs.

## Does it support Windows as the REMOTE host?

Not currently. The daemon is built for Linux (amd64 / arm64) and macOS (Intel / Apple Silicon). Windows + WSL works (treat WSL as the remote — the daemon runs Linux). Native Windows + OpenSSH server is on the roadmap but not started.

## Can I use it without the daemon (SFTP-only)?

Yes — set the profile Mode to `sftp`. No daemon deployment, slower per-op latency (~50–100 ms vs ~5–10 ms), and no `fs.watch` push notifications (the plugin polls for changes instead). Useful when you cannot deploy a binary on the remote (locked-down hosting, restricted shell, etc.).

## Does the plugin upload anything to a third party?

No. All traffic is over your SSH connection to your host. Telemetry counters (opt-in, off by default) are local-only — there is no "phone home" path in the codebase.

## Why a separate `known_hosts` from `~/.ssh/known_hosts`?

Trust scoping. See [[en/security/host-keys|Host-key trust]] for the long answer.

## Does the plugin re-deploy the daemon every time I connect?

No — the plugin has a reuse probe that runs first ([[en/server/auto-deploy#what-happens-in-order|step 2 in auto-deploy]]). If your previous daemon's socket + token are still healthy and the protocol version matches, it attaches and skips the binary upload entirely (~1 s reconnect instead of ~5 s).

The deploy fallback only fires when the probe fails — typically because the daemon isn't running yet (first connect or after a reboot), the token is gone, or the daemon's protocol version doesn't match what the current plugin bundle expects.

Run your remote daemon under [[en/server/systemd|systemd]] and the reuse path will pick it up cleanly on every connect — no extra flag needed.

## How do I uninstall cleanly?

Local:
- Disable the plugin in Obsidian → Community Plugins.
- Delete `<vault>/.obsidian/plugins/remote-ssh/`.

Remote (each host you connected to):
```bash
ssh user@host
pkill -f obsidian-remote-server
rm -rf ~/.obsidian-remote/
```

Vault files themselves are untouched. The plugin does not touch any system files.

## How do I report a security issue?

GitHub Security Advisories: [obsidian-remote-ssh/security/advisories/new](https://github.com/sotashimozono/obsidian-remote-ssh/security/advisories/new). Coordinated disclosure preferred.

## I want feature X. Where do I ask?

Open a [GitHub discussion](https://github.com/sotashimozono/obsidian-remote-ssh/discussions) for "would be nice" features, or a [GitHub issue](https://github.com/sotashimozono/obsidian-remote-ssh/issues) if it is a concrete bug or a planned-feature ask. PRs welcome — see [[en/contributing/documentation|the contributor docs]].
