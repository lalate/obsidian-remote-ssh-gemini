---
title: systemd unit
tags: [server, deploy, systemd]
---

# systemd unit

Run the daemon as a long-lived service so it survives plugin reconnects, OS reboots, and lets you pre-deploy across many hosts.

## Why bother

Auto-deploy works fine for most setups. systemd is worth it when:

- You run the same vault from many clients (other devices, mobile relay) and want the daemon up 24/7.
- You want central logging via `journalctl` rather than file-based logs.
- You manage many hosts with config management (Ansible, NixOS) and prefer declarative service definitions.
- You want resource limits enforced (`MemoryMax`, `CPUQuota`).

## Install

```bash
# 1. Drop the binary somewhere persistent
sudo install -m 0755 -o YOUR_USER -g YOUR_USER \
  obsidian-remote-server-linux-amd64 \
  /usr/local/bin/obsidian-remote-server

# 2. Verify it's the binary you expect (see Cosign verify)
cosign verify-blob \
  --bundle obsidian-remote-server-linux-amd64.bundle \
  --certificate-identity-regexp 'https://github.com/sotashimozono/obsidian-remote-ssh/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  /usr/local/bin/obsidian-remote-server
```

## Unit file

`~/.config/systemd/user/obsidian-remote-server.service`:

```ini
[Unit]
Description=obsidian-remote-ssh daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/obsidian-remote-server \
  --vault-root=%h/notes \
  --socket=%h/.obsidian-remote/server.sock \
  --token-file=%h/.obsidian-remote/token \
  --verbose
Restart=on-failure
RestartSec=2s
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=default.target
```

Replace `%h/notes` with your vault path.

## Enable

```bash
mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote
systemctl --user daemon-reload
systemctl --user enable --now obsidian-remote-server
systemctl --user status obsidian-remote-server
```

To survive logout (no console session):
```bash
sudo loginctl enable-linger $USER
```

## Plugin profile setup

In the plugin profile, set:

| Field | Value |
|---|---|
| Daemon binary path | `/usr/local/bin/obsidian-remote-server` |
| Daemon socket path | `~/.obsidian-remote/server.sock` |
| Daemon token path | `~/.obsidian-remote/token` |

The plugin's auto-redeploy will still run by default (kill prior + reupload). To disable that and let the systemd-managed daemon live, see the planned `Reuse existing daemon` flag in [[en/server/auto-deploy|auto-deploy]].

## Logs

```bash
journalctl --user -u obsidian-remote-server -f
```

Replaces `~/.obsidian-remote/server.log` for the systemd-managed instance.

Next: [[en/server/raspberry-pi|Raspberry Pi notes]].
