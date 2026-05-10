---
title: obsidian-remote-ssh
tags: [home]
---

> **Edit remote Obsidian vaults over SSH/SFTP** — like VS Code Remote-SSH, but for Obsidian.
>
> Open a vault that lives on a Raspberry Pi, home NAS, VPS, or any SSH-reachable Linux/macOS host directly in Obsidian. Files are kept in sync via a tiny signed daemon on the server side; your data never touches a third-party cloud.

## Start here

| If you want to… | Read |
|---|---|
| Try it in 5 minutes | [[en/getting-started/quickstart\|Quickstart]] |
| Walk through the whole setup once, with verification | [[en/tutorial\|Tutorial — zero to a working vault]] |
| Understand what gets installed where | [[en/getting-started/install\|Install]] → [[en/getting-started/first-connect\|First connect]] |
| Cookbook: do task X | [[en/cookbook/index\|Cookbook]] (RPi vault, SSH key, Tailscale, systemd) |
| Look up a specific setting | [[en/configuration/profiles\|Configuration reference]] |
| Run your own server | [[en/server/overview\|Server / deploy guide]] |
| Run the daemon by hand (systemd, containers, debugging) | [[en/reference/daemon-cli\|Daemon CLI reference]] |
| Hand-edit `data.json` or build it from a script | [[en/reference/data-json\|data.json schema reference]] |
| Speed it up — "things feel slow" | [[en/operations/performance-tuning\|Performance tuning]] |
| Decide if this plugin is the right tool vs Sync / Syncthing / Git | [[en/comparison\|Comparison vs other Obsidian sync tools]] |
| Verify the daemon binary you downloaded | [[en/security/cosign-verify\|Cosign verification]] |
| Build something against the protocol | [[en/api/overview\|API & protocol reference]] (and [[en/api/examples\|copy-pasteable JSON-RPC examples]]) |
| Look up a term | [[en/glossary\|Glossary]] |
| What's coming next | [[en/roadmap\|Roadmap]] |

## Sections

- **[[en/getting-started/install|Getting started]]** — install, first connect, what to expect
- **[[en/tutorial|Tutorial]]** — long-form walkthrough from zero to verified setup
- **[[en/cookbook/index|Cookbook]]** — task-oriented how-tos (RPi vault, SSH keygen, Tailscale, systemd)
- **[[en/user-guide/ssh-config|User guide]]** — SSH config import, jump hosts, host keys, conflict handling, terminal pane, plugin compatibility
- **[[en/configuration/profiles|Configuration reference]]** — every plugin setting documented
- **[[en/server/overview|Server / deploy]]** — Docker, systemd, Raspberry Pi, auto-deploy
- **[[en/api/overview|API & protocol]]** — RPC methods, error codes, payload shapes, copy-pasteable [[en/api/examples|examples]]
- **[[en/security/model|Security]]** — threat model, signing, token handling, host-key trust
- **[[en/operations/troubleshooting|Operations]]** — logs, daemon panel, reconnect, upgrading, uninstalling, common failures
- **[[en/architecture/index|Architecture]]** — shadow vault design, sync internals, performance
- **[[en/glossary|Glossary]]** — terms used across the docs, defined once
- **[[en/roadmap|Roadmap]]** — what's left before v1.0 + v2 mobile plan
- **[[en/changelog|Changelog & releases]]** — major-milestone overview + how to find per-release notes
- **[[en/privacy|Privacy & data handling]]** — what data this plugin handles, where it lives, what does (or does not) leave your machines
- **[[en/migration/from-obsidian-sync|Migrating from Obsidian Sync]]** — switchover guide for users coming from Obsidian's official paid sync service
- **[[en/comparison|Comparison]]** — full breakdown vs Obsidian Sync, Syncthing, Dropbox/iCloud, Git-based, Nextcloud, and the Remotely Save plugin
- **[[en/faq|FAQ]]** — quick answers to recurring questions

## Release channels

| Channel | Manifest source | Install via | Cadence |
|---|---|---|---|
| **Stable** | `manifest.json` (root) | Obsidian Community Plugins | When `next` is promoted to `main` (manual) |
| **Beta** | `manifest-beta.json` (root) | [BRAT](https://github.com/TfTHacker/obsidian42-brat) (`obsidian42-brat`, slug `sotashimozono/obsidian-remote-ssh`, **--beta**) | Every merge to `next` (continuous) |

The version shape is the truth: `1.0.43` is stable, `1.0.44-beta.N` is a prerelease. See [`CONTRIBUTING.md` → Branching model](https://github.com/sotashimozono/obsidian-remote-ssh/blob/next/CONTRIBUTING.md#branching-model--next-beta--main-stable) for how that's enforced.

## Project status

1.0 released. The shadow-vault architecture is operational; BRAT users are running it daily. Community-store listing is pending Obsidian-team review ([obsidianmd/obsidian-releases#12390](https://github.com/obsidianmd/obsidian-releases/pull/12390)). Mobile support (iOS/Android) is parked as a v2.0 milestone ([#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151)). See the [GitHub issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues) for the live roadmap.

## License

[MIT](https://github.com/sotashimozono/obsidian-remote-ssh/blob/main/LICENSE).
