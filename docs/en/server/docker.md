---
title: Docker (turn-key sshd)
tags: [server, deploy, docker]
---

# Docker — turn-key sshd + auto-deploy

The repo ships a Docker setup that gives you a sandbox sshd container in one command. Useful for trying obsidian-remote-ssh without setting up SSH on a real server, hosting a shared vault for several family members or teammates, or running CI integration tests.

## Quickstart

```bash
git clone https://github.com/sotashimozono/obsidian-remote-ssh
cd obsidian-remote-ssh/deploy/docker

cp ~/.ssh/id_ed25519.pub authorized_keys
cp .env.example .env

docker compose up -d --build
```

Connect from the plugin:

| Field | Value |
|---|---|
| Host | `localhost` (or your Docker host's IP) |
| Port | `2222` (configurable in `.env`) |
| Username | `obsidian` |
| Auth | Private key (your existing key) |
| Remote vault path | `/home/obsidian/vault` |

## What is inside

- Single sshd container, port 2222 (configurable).
- Non-privileged `obsidian` user (uid 1000).
- **Pubkey-only auth** (passwords disabled).
- **Persistent host keys** (`./hostkeys/` on host) — survives container recreate, so trust survives upgrades.
- Vault directory bind-mounted from host (`./vault/` by default).
- The daemon auto-deploys into `~/.obsidian-remote/` on first connect.

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `HOST_PORT` | `2222` | Host-side TCP port |
| `VAULT_PATH` | `./vault` | Host folder mounted into the container as the vault |
| `AUTHORIZED_KEYS_PATH` | `./authorized_keys` | One pubkey per line, OpenSSH format |
| `HOSTKEYS_PATH` | `./hostkeys` | Persistent sshd host keys |

## Multiple users

Add more public keys to `./authorized_keys` (one per line). Restart sshd:
```bash
docker compose restart
```

Each user spawns their own daemon process under the shared `obsidian` account; they coexist via independent socket paths configured per profile.

For real isolation (per-user vaults), run multiple containers with different mounts.

## Production use

This image is reasonable for small home / family use. For real production:

- Put it behind a reverse-tunnel proxy (Tailscale, Cloudflare Tunnel) — do NOT expose port 2222 directly to the internet.
- Run the container under a non-root user namespace.
- Mount `/home/obsidian/.obsidian-remote/` as a volume so daemon state survives container recreate; otherwise the token regenerates on each restart and existing plugin sessions need to reconnect.

Next: [[en/server/systemd|systemd]].
