---
title: Generating an SSH key
tags: [cookbook, how-to, ssh]
description: "Generate an SSH key the obsidian-remote-ssh plugin can use: ed25519 vs ed25519-sk vs RSA, passphrase choice, ssh-agent integration, where to put the public key."
---

# Generating an SSH key

If `ssh user@host` asks you for a password, you do not have a usable key for that host yet. Here is the 5-minute fix.

## On your local machine

Generate a modern Ed25519 key:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

Press Enter to accept the default path (`~/.ssh/id_ed25519`). When asked for a passphrase: enter one. The plugin works with passphrase-protected keys when you use **SSH agent** auth.

## Add it to your agent

```bash
# macOS / Linux
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

```powershell
# Windows (one-time)
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add $HOME\.ssh\id_ed25519
```

The agent unlocks the key once per session; subsequent `ssh` calls (and the plugin) won't re-prompt.

## Copy the public key to the remote

```bash
ssh-copy-id user@host
```

On Windows / hosts without `ssh-copy-id`, the manual form:

```bash
cat ~/.ssh/id_ed25519.pub | ssh user@host \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

## Verify

```bash
ssh user@host "echo it works"
```

You should NOT be asked for a password.

## In the plugin

Profile **Authentication**:
- **SSH agent** — preferred. The agent has the unlocked key in memory; the plugin never sees the passphrase.
- **Private key** — point at `~/.ssh/id_ed25519`. The plugin prompts for the passphrase once per connect.

## Hardware-key alternatives

Anything `ssh-agent` can sign with works. Common setups:

- **YubiKey / Nitrokey** — set up `ssh-add -K` (resident key) or use the OpenSSH `sk-ssh-ed25519` key type. Then pick **SSH agent** in the plugin.
- **Apple Secure Enclave** — `ssh-keygen -t ed25519-sk -O resident` requires a TouchID prompt; pair with the `ssh-agent` daemon shipped with macOS.

## See also

- [[en/user-guide/ssh-config|User guide → SSH config & keys]]
- [[en/security/host-keys|Host-key trust]] — the OTHER half of "how does the plugin know it's talking to the right host"
