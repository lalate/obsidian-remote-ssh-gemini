---
title: systemd-managed daemon
tags: [cookbook, how-to, systemd, security]
description: "Replace the auto-deployed daemon with a systemd-managed one: cosign-verify the binary first, install as a user unit, enable lingering, monitor with journalctl."
schema: Article
---

# systemd-managed daemon (with cosign verification)

Goal: run a **cosign-verified** daemon binary you control under systemd, so the daemon survives plugin restarts and OS reboots. Useful for: hosts you keep on 24/7, hosts shared with other users, hosts where you want central logging via `journalctl`.

> Good news: the plugin already supports this without any opt-in flag. The reuse-existing-daemon probe (see [[en/server/auto-deploy#what-happens-in-order|auto-deploy step 2]]) attaches to your systemd-managed daemon when it's healthy and skips the binary upload. The deploy fallback only fires if the socket / token / handshake fails — most commonly because your binary version doesn't match the bundle the current plugin was built against.

## 1. Download + verify the binary

On a trusted machine (your laptop), grab the binary + bundle for your remote's arch from the [Releases](https://github.com/sotashimozono/obsidian-remote-ssh/releases) page:

```bash
gh release download 1.0.43 --repo sotashimozono/obsidian-remote-ssh \
  --pattern 'obsidian-remote-server-linux-arm64*' \
  --pattern 'daemon-manifest.json*'
```

Verify the manifest:

```bash
cosign verify-blob \
  --bundle daemon-manifest.json.bundle \
  --certificate-identity-regexp \
    'https://github.com/sotashimozono/obsidian-remote-ssh/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  daemon-manifest.json
```

You should see `Verified OK`. Then check the binary's hash matches the manifest:

```bash
grep linux-arm64 daemon-manifest.json
# "obsidian-remote-server-linux-arm64": "abc123...sha256...def456"
sha256sum obsidian-remote-server-linux-arm64
# abc123...def456  obsidian-remote-server-linux-arm64
```

Hashes match → the binary is the one signed by THIS repo's release pipeline.

For full background on what cosign is checking, see [[en/security/cosign-verify|Cosign verify]].

## 2. Copy the binary to the remote

```bash
scp obsidian-remote-server-linux-arm64 user@remote:~/
ssh user@remote 'sudo install -m 0755 -o $USER -g $USER \
  ~/obsidian-remote-server-linux-arm64 \
  /usr/local/bin/obsidian-remote-server'
```

## 3. systemd unit (per-user)

`~/.config/systemd/user/obsidian-remote-server.service` on the remote:

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

Replace `%h/notes` with your vault path. Then:

```bash
mkdir -p ~/.obsidian-remote && chmod 700 ~/.obsidian-remote
systemctl --user daemon-reload
systemctl --user enable --now obsidian-remote-server
```

To survive logout (no console session attached):

```bash
sudo loginctl enable-linger $USER
```

## 4. Plugin profile

In the plugin, configure the profile to point at the same paths the unit uses:

| Field | Value |
|---|---|
| Daemon socket path | `.obsidian-remote/server.sock` (home-relative) |
| Daemon token path | `.obsidian-remote/token` (home-relative) |

Connect from the plugin. The reuse probe will find the live socket + valid token your systemd-managed daemon set up and skip the binary upload entirely.

If the connect surprises you by deploying anyway, the most common cause is a binary-version mismatch: the daemon you put under systemd was built against a different protocol/version than the plugin bundle expects, the handshake fails, and the plugin falls through to deploy. Re-download the binary from the [release matching your current plugin version](https://github.com/sotashimozono/obsidian-remote-ssh/releases) and re-`systemctl --user restart`.

## 5. Logs

```bash
journalctl --user -u obsidian-remote-server -f
```

Replaces `~/.obsidian-remote/server.log` for the systemd-managed instance.

## See also

- [[en/server/systemd|Server / systemd unit]] — the canonical reference
- [[en/security/cosign-verify|Cosign verify]] — the full verify story
- [[en/server/auto-deploy|Server / auto-deploy]] — what the plugin does by default
