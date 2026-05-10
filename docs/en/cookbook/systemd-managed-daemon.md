---
title: systemd-managed daemon
tags: [cookbook, how-to, systemd, security]
---

# systemd-managed daemon (with cosign verification)

Goal: instead of letting the plugin auto-deploy + redeploy the daemon on every connect, run a **cosign-verified** binary you control under systemd. Useful for: hosts you keep on 24/7, hosts where you want explicit lifecycle ownership, hosts shared with other users.

> Trade-off: at time of writing the plugin's auto-deploy still runs on every connect by default — it will overwrite the binary you placed under systemd. The "reuse existing daemon" profile flag is on the roadmap; until then, treat this setup as "warm spare" + accept the redeploy.

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

Connect once. The plugin will (currently) redeploy the binary, then attach to the socket. Your systemd unit's binary gets overwritten on this first connect — that's the unfortunate-but-temporary trade-off. The systemd lifecycle still wins after that: the daemon survives plugin restarts, and on Pi reboot systemd brings it back up before you connect from anywhere.

## 5. Logs

```bash
journalctl --user -u obsidian-remote-server -f
```

Replaces `~/.obsidian-remote/server.log` for the systemd-managed instance.

## See also

- [[en/server/systemd|Server / systemd unit]] — the canonical reference
- [[en/security/cosign-verify|Cosign verify]] — the full verify story
- [[en/server/auto-deploy|Server / auto-deploy]] — what the plugin does by default
