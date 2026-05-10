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
| Understand what gets installed where | [[en/getting-started/install\|Install]] → [[en/getting-started/first-connect\|First connect]] |
| Look up a specific setting | [[en/configuration/profiles\|Configuration reference]] |
| Run your own server | [[en/server/overview\|Server / deploy guide]] |
| Verify the daemon binary you downloaded | [[en/security/cosign-verify\|Cosign verification]] |
| Build something against the protocol | [[en/api/overview\|API & protocol reference]] |

## Sections

- **[[en/getting-started/install|Getting started]]** — install, first connect, what to expect
- **[[en/user-guide/ssh-config|User guide]]** — SSH config import, jump hosts, host keys, conflict handling, terminal pane
- **[[en/configuration/profiles|Configuration reference]]** — every plugin setting documented
- **[[en/server/overview|Server / deploy]]** — Docker, systemd, Raspberry Pi, auto-deploy
- **[[en/api/overview|API & protocol]]** — RPC methods, error codes, payload shapes
- **[[en/security/model|Security]]** — threat model, signing, token handling, host-key trust
- **[[en/operations/troubleshooting|Operations]]** — logs, daemon panel, reconnect, common failures
- **[[en/architecture/shadow-vault|Architecture]]** — shadow vault design, sync internals, performance
- **[[en/faq|FAQ]]** — quick answers to recurring questions

## Release channels

| Channel | Manifest source | Install via | Cadence |
|---|---|---|---|
| **Stable** | `manifest.json` (root) | Obsidian Community Plugins | When `next` is promoted to `main` (manual) |
| **Beta** | `manifest-beta.json` (root) | [BRAT](https://github.com/TfTHacker/obsidian42-brat) (`obsidian42-brat`, slug `sotashimozono/obsidian-remote-ssh`, **--beta**) | Every merge to `next` (continuous) |

The version shape is the truth: `1.0.43` is stable, `1.0.44-beta.N` is a prerelease. See [[en/contributing/release-flow|the release flow]] for how that's enforced.

## Project status

Pre-1.0. The shadow-vault architecture is operational, BRAT users are running it daily. The major remaining work is mobile support (iOS/Android) and the multi-client conflict resolver. See the [GitHub issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues) for the live roadmap.

## License

[MIT](https://github.com/sotashimozono/obsidian-remote-ssh/blob/main/LICENSE).
