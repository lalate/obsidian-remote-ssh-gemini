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

## Why does the plugin re-deploy the daemon every time I connect?

Default behaviour, easy to override (planned profile flag). Re-deploy is ~5 seconds and guarantees you are running the version the plugin was built against. Reusing skips that latency but means you can drift between plugin and daemon versions.

If your remote daemon is managed by [[en/server/systemd|systemd]] and you do not want the plugin touching it, a "reuse existing daemon" profile flag is on the roadmap; until then, the plugin will redeploy on connect.

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
