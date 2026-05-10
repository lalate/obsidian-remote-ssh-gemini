---
title: Comparison vs other Obsidian sync tools
tags: [comparison, overview]
---

# Comparison vs other Obsidian sync tools

There are many ways to "make my Obsidian vault available on more than one device". This page compares **obsidian-remote-ssh** to the most common alternatives so you can pick the right tool — including cases where the right tool is **not** this plugin.

> **Spirit of this page.** No tool is "best"; tools are best-fit for a model. The comparison is honest about where this plugin loses. If your model fits Obsidian Sync better, use Obsidian Sync.

## At-a-glance

| | obsidian-remote-ssh | Obsidian Sync | Syncthing | Dropbox / iCloud / OneDrive | Obsidian Git | Nextcloud | [Remotely Save](https://github.com/remotely-save/remotely-save) plugin |
|---|---|---|---|---|---|---|---|
| **Topology** | One canonical copy on YOUR remote (server-of-truth) | Cloud (Obsidian's servers) is server-of-truth | Peer-to-peer; every device holds a full copy | Cloud is server-of-truth | Git remote is server-of-truth | Cloud-of-yours (self-hosted) is server-of-truth | Cloud is server-of-truth |
| **Editing model** | Direct remote edit (no full local copy) | Local edit + background sync | Local edit + background sync | Local edit + background sync | Local edit + manual commit/push | Local edit + background sync | Local edit + manual sync |
| **Auth** | SSH keys (yours) | Obsidian account | Device IDs (yours) | Service account | Git auth (SSH/HTTPS) | Nextcloud account | Per-backend (S3/OneDrive/Dropbox/WebDAV…) |
| **At-rest encryption** | Remote host's responsibility (LUKS / FileVault / encrypted ZFS dataset) | E2EE option with your password | Per-folder encryption | Service-side, not E2EE by default | Whatever the git host does | Server-side; E2EE addon | Per-backend; some support E2EE |
| **In-flight encryption** | SSH | TLS + E2EE option | TLS | TLS | SSH/HTTPS | TLS | Per-backend (TLS) |
| **Conflict model** | mtime preconditions; daemon-mediated; conflict surfaced to UI | Vector clock; cloud-mediated; mostly auto | mtime + version vectors; can produce `*-conflict-*` files | mtime; produces `*-conflict-*` files routinely | Git merge; you resolve in editor / CLI | Server arbitrates; can produce `(conflict copy)` files | Per-backend; unresolved conflicts go to a conflict folder |
| **Mobile (iOS / Android Obsidian)** | No, desktop-only ([#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151)) | First-class | Android only; no iOS | Yes (with caveats — iOS sandbox sometimes lags) | Mobile Git plugins exist but flaky | Yes (Nextcloud app) | Yes |
| **Cost** | Self-hosted: free + your hardware/VPS | Subscription | Free | Subscription beyond free tier | Free (your git host) | Self-hosted: free + your hardware | Free (plus your storage cost) |
| **Selective sync** | No, whole vault only | No | Per-folder share level | Some clients support it | Manual via `.gitignore` | Per-folder | Per-folder include/exclude |
| **Version history** | None — use server-side backups instead ([[en/cookbook/backup-restore\|recipe]]) | Per-file history in UI (paid) | Optional file-versioning addon | Recycle bin / version history (paid tiers) | Native to git | Per-file history | Per-backend; not in plugin itself |
| **Works offline** | No — needs SSH reachability | Cached locally | Local-first | Cached locally | Local-first | Cached locally | Cached locally (the local copy IS the vault) |
| **Risk if your "cloud" disappears** | N/A — it IS your cloud | Vault inaccessible until restored | N/A — every device has it | Vault inaccessible until restored | Vault still on every clone | Self-hosted: same as us | Local copy survives |

The **most important row is Topology.** Every other property follows from it.

## Pick by user type

### "I want it to just work, including on mobile"

→ **Obsidian Sync.** It's a paid product because the productisation costs money. If your appetite for ops is "none", pay for Sync.

### "I want all my files on every device, no central server"

→ **Syncthing.** Peer-to-peer, no central anything, free. The downside is the conflict-resolution UX (`*-conflict-*` files) and Android-only mobile.

### "I already pay for Dropbox / iCloud / OneDrive, why install anything?"

→ **Use what you have.** It works fine for single-device-at-a-time editing. The classic failure is "I edited on laptop offline; iPad synced overnight; opening the file shows a `(conflict copy)` next to the real one." Live with that and move on.

### "I want git-style version history of every change"

→ **Obsidian Git plugin.** Every save (or every interval) becomes a commit. Great history, fragile mobile story, requires you to think in git.

### "I have a homelab and want self-hosted everything"

→ **Either Nextcloud or this plugin.** Nextcloud sync if you want full-replica (vault on every device) and a richer ecosystem. obsidian-remote-ssh if you want **single canonical copy** (no replicas to worry about, no per-device disk usage, edit-on-server model).

### "I want this plugin's model: vault stays on the remote, no replicas"

→ **obsidian-remote-ssh.** This is the niche we exist for.

## When obsidian-remote-ssh is the right choice

The plugin's model fits well when:

- **You own a remote that's almost always reachable.** Home Pi over Tailscale, NAS, VPS, work dev box. SSH-reachable from your editing devices.
- **You don't want N copies of your vault.** A single canonical copy on the remote is exactly what you want. No "which device has the latest" question.
- **You're already in the SSH-keys-and-Linux mindset.** Adding another SSH host to a setup you already maintain is roughly zero ops overhead.
- **Your privacy threshold rules out third-party cloud.** Notes never touch anyone's servers but yours.
- **You're desktop-primary.** If mobile is a "nice to have", this works; if it's a hard requirement, see below.
- **Big vaults (10k+ files).** The plugin lazy-fetches; you don't keep tens of thousands of files synced on every laptop.

## When obsidian-remote-ssh is the wrong choice

Be honest about these — using the wrong tool because of the wrong reason just hurts you:

- **You need mobile editing.** Desktop only ([#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151)). Use Obsidian Sync, or Syncthing/Nextcloud paired with the Obsidian mobile app.
- **You're often offline.** SSH-unreachable means no editing. Replicating sync (Sync, Syncthing, Dropbox, Nextcloud) lets you edit offline; this plugin doesn't.
- **You don't have a remote at all.** Spinning up a VPS just to run this is fine, but if "no infrastructure" is a goal, pick Sync or Syncthing.
- **You want per-file undo from a UI.** We don't have it. Use Sync (paid) or git-based, or pair this plugin with [[en/cookbook/backup-restore|server-side restic backups]] and accept that "undo" is a CLI restore.
- **You need real-time collaboration.** Two people editing the same file at the same instant is conflict territory in any of these tools, but it's especially abrupt in this plugin (mtime check; one side gets a conflict). For collab-doc workflows, neither this nor Sync is the right tool — look at HedgeDoc / etherpad-style.

## Specific comparisons (deeper)

### vs Obsidian Sync

The closest peer in spirit (both are "Obsidian-aware sync"). The dividing line is **who owns the canonical store**:

- Sync: Obsidian's servers. Pay a subscription, get mobile + per-file history + cross-device E2EE.
- This plugin: your server. Free, more ops surface, no mobile yet.

Obsidian Sync is a great product. If you can pay the subscription and the data-residency model is fine, it's the lower-friction choice. This plugin is for people who specifically want self-hosting.

See the dedicated [[en/migration/from-obsidian-sync|migration guide]] if you're switching.

### vs Syncthing

Syncthing is the **opposite topology** — not "central server" but "every device has a full copy, peers gossip changes". Strengths:

- No central anything; truly P2P.
- Free, self-hosted, mature.
- Works fully offline on every device.

Where it's harder than this plugin:

- **Disk pressure on every device.** A 5 GB vault eats 5 GB on every device.
- **Conflict UX.** Two laptops editing the same file produces `*-sync-conflict-...md` files; you reconcile by hand. (We have the same problem with two clients editing the same file, but the conflict surfaces in the Obsidian UI before either save lands rather than as a sibling file.)
- **No iOS Obsidian.** Syncthing has no iOS client at all.

If you have one laptop + one phone (Android), Syncthing is great. If you have 4 devices and a phone, the disk-and-conflict story gets messier than this plugin's central-server story.

### vs Dropbox / iCloud / OneDrive

These work but **Obsidian explicitly warns against putting an active vault inside a sync folder.** The classic failure is `.obsidian/workspace.json` getting trampled mid-write, plugin caches racing each other, attachments syncing while you're editing them. People do it anyway because it's zero-setup. It mostly works until it doesn't.

The cloud-storage path is fine if:

- You only edit on one device at a time.
- You're OK doing manual conflict-copy cleanup occasionally.
- You're not doing heavy plugin work that writes to `.obsidian/` constantly.

If those don't hold, get a real Obsidian-aware tool — Sync, this plugin, or Syncthing.

### vs Obsidian Git

Beautiful for "I want every save committed":

- Real version history with `git log` and `git blame`.
- Works with any git host (GitHub, GitLab, self-hosted Gitea / Forgejo).
- Free.

Costs:

- **Mobile is fragile.** The mobile Git plugins exist but routinely break with auth changes, large repos, or background-sync limitations on iOS.
- **Conflict resolution is git-flavoured.** If you can resolve a merge conflict in `vim`, this is fine. If not, it's a usability cliff.
- **Large attachments (images, PDFs) bloat the git history.** Git LFS is the answer; setting it up correctly inside an Obsidian vault is non-trivial.

Often the best fit is **this plugin + an opportunistic git mirror on the remote** (cron a `git commit -am snapshot && git push` every hour). You get this plugin's editing model + git's history, and Obsidian doesn't have to know about git at all.

### vs Nextcloud (with Obsidian client)

Nextcloud is the natural "I want the whole self-hosted-cloud experience" answer. The Obsidian-relevant comparison:

- Nextcloud syncs files via its desktop/mobile clients into a local folder; you point Obsidian at that folder. Same shape as Dropbox, but self-hosted.
- It has the same "vault in a sync folder" sharp edges as Dropbox, although Nextcloud's conflict story is generally cleaner.
- **Mobile works** — Nextcloud's iOS / Android apps are mature.
- It's a much heavier piece of software to operate (PHP stack, database, periodic upgrades, occasional storage-corruption issues). Operating Nextcloud well is a real time investment.

If you already run Nextcloud, you don't need us. If you don't already run it and the only reason to install it would be "for Obsidian", this plugin is a much smaller surface area.

### vs the Remotely Save plugin

[Remotely Save](https://github.com/remotely-save/remotely-save) is the popular "sync your vault to S3 / Dropbox / OneDrive / WebDAV" plugin. Different model:

- Remotely Save: local-first, periodic sync to a remote object store. Vault lives on every device; the cloud is a sync target.
- This plugin: remote-first, edit-against-the-server. Vault lives only on the remote; local is a window.

Pick Remotely Save when:

- You want to keep the local-first model (offline editing, fast file ops).
- Your remote of choice is an object store (S3, R2, Backblaze, OneDrive) rather than an SSH host.
- You want mobile.

Pick this plugin when:

- You don't want N copies of the vault.
- You have an SSH-reachable host.
- You want sub-second file open over LAN/Tailscale (no "sync delay" between devices).

> Trivia: this repository was originally a fork of Remotely Save before the architecture diverged hard enough to need a different name and a different project. Different goals, different tradeoffs.

## "Can I run two of these?"

Yes — they're not mutually exclusive:

- **This plugin + Obsidian Sync (mobile-only).** Use Sync just for the mobile bridge; this plugin for desktop. Sync sees the remote vault as a set of files; the conflict surface is "did the mobile-edit and the desktop-edit collide?" which is the same problem you have with one tool.
- **This plugin + git mirror.** As above — the remote runs an hourly `git commit && git push` cron; you get history without paying it on the editing path.
- **This plugin + restic / borg backups.** The mandatory pairing if version history matters to you. See [[en/cookbook/backup-restore|backup recipe]].

The combinations aren't great if you stack two _replicating_ tools (Sync + Syncthing on the same vault is a recipe for grief), but pairing this plugin with **non-replicating** companions (mobile bridge, history snapshots, backup) is fine and often the right answer.

## See also

- [[en/faq|FAQ]] — short comparison table + recurring questions
- [[en/migration/from-obsidian-sync|Migrating from Obsidian Sync]] — if you've already picked us
- [[en/cookbook/backup-restore|Backup & restore]] — the mandatory pairing for version-history needs
- [[en/architecture/index|Architecture]] — how the remote-first model actually works
- [[en/roadmap|Roadmap]] — including the mobile plan (v2.0)
