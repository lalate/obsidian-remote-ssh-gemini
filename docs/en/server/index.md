---
title: Server / deploy
tags: [server, deploy]
---

# Server / deploy

How the daemon side gets onto your remote host and stays running. **Most users don't need any of this** — the plugin auto-deploys the daemon on connect. Reach for these pages when you want to manage the daemon yourself (systemd, containers, multiple users on one host, restricted networks).

> **Start with [[en/server/overview|the Server overview]]** — it covers what the daemon is, what it needs from the host, and what it does NOT do. The other pages are the deployment options.

## Pages

| Page | What it covers |
|---|---|
| [[en/server/overview\|Overview]] | What the daemon is, what it needs, what it does not do |
| [[en/server/auto-deploy\|Plugin auto-deploy]] | The default — what happens when you click Connect |
| [[en/server/docker\|Docker]] | Run the daemon inside an sshd container; turn-key compose file |
| [[en/server/systemd\|systemd]] | Per-user systemd unit; production-grade lifecycle management |
| [[en/server/raspberry-pi\|Raspberry Pi]] | Pi-specific notes — SD card vs USB SSD, ARM binary, expectations |
| [[en/server/multi-user\|Multi-user hosting]] | One host, many SSH users; the per-user-state model + the anti-pattern of sharing one OS user |
| [[en/server/firewall\|Firewall, ports & NAT]] | Why the daemon needs no public ports + how Tailscale/wireguard fit in |
| [[en/server/signing\|Signing]] | Operator-side: what the cosign signatures cover, when to verify, who signs |

## Reading order

For "I just want it to work":
- Read **[[en/server/overview|Overview]]** to understand what gets deployed.
- That's it. The plugin handles everything else.

For "I want to run my own daemon under systemd":
1. **[[en/server/overview|Overview]]** for context.
2. **[[en/server/systemd|systemd]]** for the unit file.
3. **[[en/reference/daemon-cli|Daemon CLI reference]]** for the flag set the unit invokes.

For "I'm setting up a multi-user host":
1. **[[en/server/overview|Overview]]**.
2. **[[en/server/multi-user|Multi-user hosting]]** — read carefully; the wrong setup leaks state between users.
3. **[[en/server/firewall|Firewall, ports & NAT]]** if the host is internet-facing.

## See also

- [[en/reference/daemon-cli|Daemon CLI reference]] — every flag the binary accepts
- [[en/security/cosign-verify|Cosign verify]] — verify the binary you downloaded before deploying it manually
- [[en/architecture/release-pipeline|Release pipeline]] — how the binary is built + signed
- [[en/cookbook/systemd-managed-daemon|Cookbook: systemd-managed daemon]] — full walkthrough recipe
