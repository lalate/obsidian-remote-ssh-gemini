---
title: Profiles
tags: [configuration, reference]
---

# Configuration reference — Profiles

Each SSH profile is one connection target. Every field is configured per-profile under **Settings** → **Profiles** → click a profile.

## Identification

| Field | Type | Default | Description |
|---|---|---|---|
| Profile name | string | `New Profile` | Display label only |
| Host | string | (required) | Hostname or IP — anything `ssh` accepts |
| Port | number | `22` | TCP port |
| Username | string | (required) | Remote SSH user |

## Authentication

| Field | Type | Default | Description |
|---|---|---|---|
| Authentication | enum | `privateKey` | One of `privateKey`, `password`, `agent` |
| Private key path | string | — | Path to private key file; `~` expanded at runtime |

See [[en/user-guide/ssh-config|SSH config & keys]] for what each method means.

## Remote vault

| Field | Type | Default | Description |
|---|---|---|---|
| Remote vault path | string | (required) | Absolute or `~`-relative path; e.g. `/home/pi/notes`, `~/work/vault`. Must exist; the plugin will not auto-create it. |

## Transport

| Field | Type | Default | Description |
|---|---|---|---|
| Mode | enum | `rpc` | `rpc` (auto-deploys daemon) or `sftp` (legacy direct SFTP) |
| Daemon socket path | string | `~/.obsidian-remote/server.sock` | Unix socket the daemon listens on (`rpc` mode) |
| Daemon token path | string | `~/.obsidian-remote/token` | Auth token file location (`rpc` mode) |
| Daemon binary path | string | `~/.obsidian-remote/server` | Where to upload the daemon binary (`rpc` mode) |

`rpc` is recommended — ~10x lower per-op latency than SFTP and supports server-push notifications via [[en/api/watch|fs.watch]]. `sftp` exists as a fallback when you cannot deploy a daemon.

## Jump hosts

Click **Add jump host** under a profile. Each entry has its own Host / Port / Username / Auth. Hops chain in order. See [[en/user-guide/jump-host|Jump hosts]] for the model.

## Where settings live

```
<vault>/.obsidian/plugins/obsidian-remote-ssh/settings.json
```

**Passwords are never persisted**. Private key paths are stored; the keys themselves are NOT copied into the plugin (read fresh each connect).

If you sync your `.obsidian` directory across machines, your profile list syncs too — be aware that `Private key path` is a path that may not exist on every device.

Next: [[en/configuration/this-device|This device]].
