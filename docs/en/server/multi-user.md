---
title: Multi-user hosting
tags: [server, deploy, multi-user]
---

# Multi-user hosting

Hosting vaults for several users on one remote host. Covers the natural per-user-account model, how to share one OS user across humans (and why you usually shouldn't), and the multi-vault-per-user case.

## The natural model: one OS user per human

Each human gets their own OS user account on the remote. Each runs their own daemon under their own account, against their own vault directory.

```mermaid
graph TB
  subgraph host["One remote host"]
    subgraph alice["alice user"]
      A1[~/.obsidian-remote/server<br/>daemon binary]
      A2[~/.obsidian-remote/server.sock<br/>token, log]
      A3[/home/alice/notes<br/>vault]
    end
    subgraph bob["bob user"]
      B1[~/.obsidian-remote/server<br/>daemon binary]
      B2[~/.obsidian-remote/server.sock<br/>token, log]
      B3[/home/bob/notes<br/>vault]
    end
    subgraph dad["dad user"]
      D1[~/.obsidian-remote/server<br/>daemon binary]
      D2[~/.obsidian-remote/server.sock<br/>token, log]
      D3[/home/dad/notes<br/>vault]
    end
  end
```

This works **without any special config** because the plugin's defaults are home-relative:

- Socket path: `~/.obsidian-remote/server.sock` → resolves to `/home/alice/.obsidian-remote/server.sock` for alice, `/home/bob/...` for bob, etc.
- Token path: same pattern
- Daemon binary path: same pattern
- Vault path: each user sets their own

So three users sharing one host, each with their own vault, each connecting from their own laptop using their own SSH key — works out of the box. Each spawns their own daemon process under their own UID.

### Setup checklist

```bash
# As root on the remote
sudo adduser alice
sudo adduser bob
sudo adduser dad

# Each user adds their own ~/.ssh/authorized_keys
ssh-copy-id alice@remote-host    # (alice runs from her laptop)
ssh-copy-id bob@remote-host
ssh-copy-id dad@remote-host

# Each user creates their vault directory on first login
ssh alice@remote-host 'mkdir -p ~/notes'
```

In the plugin (each user on their own laptop):

| Field | Value |
|---|---|
| Username | `alice` (their own OS user) |
| Authentication | their own SSH key |
| Remote vault path | `~/notes` (or wherever they want) |

Daemons coexist via UID isolation. Sockets, tokens, and logs all live under the per-user `~/.obsidian-remote/`. No collision possible.

### Resource accounting

Each user's daemon counts against their resource limits (`ulimit`, cgroups, systemd `MemoryMax` if you wrap it per-user). For a Pi with 5 users idling, the steady-state cost is ~25 MB total RSS. Concurrent edit bursts add a bit per active session.

For a hardened deployment, set per-user systemd resource caps (see [[en/cookbook/systemd-managed-daemon|systemd-managed daemon]]) so one runaway client can't starve the others.

## One OS user, multiple humans (anti-pattern)

Sometimes asked: "can I have alice + bob + dad share one `obsidian` user account, each running their own profile from their laptop?"

You can, but **it's an anti-pattern** because:

- The token in `~obsidian/.obsidian-remote/token` is **single** — every client that can read the file authenticates as the same identity. The daemon does allow multiple concurrent sessions (`server.go:60` — *"Multiple concurrent connections are allowed; each gets its own Session"*), so connections don't kick each other, but the daemon can't tell alice's session from bob's. Inside the daemon's logs and inside the vault filesystem, every action is "user obsidian" with no per-human attribution.
- Daemons restart on plugin reconnect when the `tryReuseExistingDaemon` probe fails (typically a version mismatch with the bundled binary). When that restart happens, the token regenerates, and the OTHER user's plugin discovers their cached token is invalid on next call → also has to redeploy. Cascading thrash that wouldn't happen with one-daemon-per-OS-user.
- Vault file ownership ends up shared (`obsidian:obsidian`) so any audit-trail of "who changed what" relies on Obsidian-level metadata, not OS-level uid info.

The Docker setup (`deploy/docker/`) ships exactly this single-user pattern by design — fine for a single human or a "one container per human" deployment. For multiple humans on one host, give them separate OS accounts.

## One OS user, multiple vaults (this works fine)

If a single human wants several distinct vaults on one host (work, personal, family) under one OS account:

- Use **multiple plugin profiles**, each pointing at a different vault path under the same SSH user
- All profiles share the same daemon (one socket per OS user)
- See [[en/cookbook/multi-vault|Editing multiple vaults from one Obsidian]] for the laptop side

Daemon arguments support this: the daemon takes `--vault-root` at startup. Connecting to a different vault root requires a different daemon (different `--vault-root` arg), which means a different socket. The plugin handles this by auto-deploying with a per-profile socket path:

| Profile | Socket path |
|---|---|
| Work vault | `~/.obsidian-remote/server.sock` (default) |
| Personal vault | `~/.obsidian-remote/server-personal.sock` (override in profile Transport settings) |

Each profile spawns its own daemon process pointed at its own vault root.

## Container-isolated multi-user

For more isolation than OS users (or to make per-user resource limits trivial), run **one Docker container per user**:

```yaml
# docker-compose.yml
services:
  vault-alice:
    extends:
      file: deploy/docker/docker-compose.yml
      service: sshd
    volumes:
      - ./vault-alice:/home/obsidian/vault
      - ./alice-authorized_keys:/home/obsidian/.ssh/authorized_keys:ro
    ports:
      - "22001:2222"
  vault-bob:
    extends:
      file: deploy/docker/docker-compose.yml
      service: sshd
    volumes:
      - ./vault-bob:/home/obsidian/vault
      - ./bob-authorized_keys:/home/obsidian/.ssh/authorized_keys:ro
    ports:
      - "22002:2222"
```

Each container has its own sshd, its own `obsidian` user, its own daemon, its own vault. Filesystem isolation is at the container boundary. See [[en/cookbook/reverse-proxy|Reverse proxy]] for fronting multiple containers under one public hostname.

## Auth + identity caveats

- **Per-OS-user model**: SSH-level audit (auth.log, last) shows real human → real OS user. Best for accountability.
- **Shared OS user**: SSH still records the source IP / pubkey, but everything inside the daemon is "user obsidian did X" with no further provenance.
- **Container-per-user**: Like per-OS-user but with stronger filesystem boundaries; each container's auth.log is independent.

## See also

- [[en/cookbook/multi-vault|Editing multiple vaults from one Obsidian]] — laptop-side multi-vault, complementary
- [[en/server/docker|Server / Docker turn-key sshd]] — base for container-isolated multi-user
- [[en/cookbook/reverse-proxy|Reverse proxy]] — fronting multiple containers
- [[en/configuration/profiles|Profiles]] — per-profile socket-path override for the multi-vault case
