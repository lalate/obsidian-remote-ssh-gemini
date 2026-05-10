---
title: Install
tags: [getting-started, install]
---

# Install obsidian-remote-ssh

You can install via the **Obsidian Community Plugins store** (stable) or **BRAT** (beta channel — features land here first). Both ship the same plugin codebase; the only difference is which manifest BRAT/Obsidian fetches.

## Option 1 — Community Plugins store (stable)

> Status: **submission in progress**. Use BRAT for now if you want the current build.

1. Open Obsidian → **Settings** → **Community plugins**.
2. Disable **Restricted mode** if it's on.
3. Click **Browse**, search for `obsidian-remote-ssh`.
4. Install → Enable.

## Option 2 — BRAT (beta channel)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) lets you install plugins directly from a GitHub repo's `manifest-beta.json`. Recommended if you want every fix the day it lands on `next`.

1. Install **BRAT** from the Community Plugins store first.
2. Open BRAT settings → **Add Beta plugin**.
3. Paste the repo slug:
   ```
   sotashimozono/obsidian-remote-ssh
   ```
4. Pick **--beta** so BRAT follows `manifest-beta.json` instead of the stable `manifest.json`.
5. Wait a few seconds for download, then enable **obsidian-remote-ssh** in Community Plugins.

BRAT auto-updates on Obsidian launch. To pin a specific version, set BRAT's "Auto-update at startup" to off.

## Option 3 — Manual install

For air-gapped Obsidian instances or to inspect the bundle before loading.

1. Download the latest release artefacts from [Releases](https://github.com/sotashimozono/obsidian-remote-ssh/releases):
   - `main.js` (plugin bundle)
   - `manifest.json`
   - `styles.css`
2. Copy the three files into:
   ```
   <vault>/.obsidian/plugins/obsidian-remote-ssh/
   ```
3. Restart Obsidian → **Settings** → **Community plugins** → enable **obsidian-remote-ssh**.

## Server side

The plugin auto-deploys a **signed daemon binary** (`obsidian-remote-server`) onto every host you connect to — you don't need to install anything manually on the remote unless you want to. See [[en/server/overview|Server / deploy]] for what gets installed where, and [[en/security/cosign-verify|Cosign verification]] to verify the daemon yourself.

## Requirements

| | |
|---|---|
| Obsidian | 1.5.0 or newer |
| Local OS | macOS, Linux, Windows |
| Remote OS | Linux (amd64 / arm64), macOS (Intel / Apple Silicon) |
| Remote SSH | OpenSSH 8.0+ recommended; password, public key, and SSH agent auth all supported |
| Mobile | Not yet — see the [mobile-relay tracker](https://github.com/sotashimozono/obsidian-remote-ssh/issues?q=label%3Amobile) |

Next: [[en/getting-started/first-connect|First connect]].
