---
title: Hardware-key SSH auth (YubiKey, TouchID, Secure Enclave)
tags: [cookbook, how-to, ssh, security, hardware]
description: "Use a YubiKey, Nitrokey, macOS Secure Enclave, or Windows Hello to sign SSH connections to your Obsidian vault. FIDO2 ed25519-sk + Apple keychain + TPM recipes."
schema: Article
---

# Hardware-key SSH auth

Sign SSH connections with a key that lives in tamper-resistant hardware — your YubiKey, your laptop's Secure Enclave, or any FIDO2 authenticator. The plugin uses your normal `ssh-agent`, so anything `ssh` can authenticate with works here too.

## Why hardware-back the key

The private key never leaves the secure element. A laptop compromise gives an attacker your `ssh-agent` socket while you're logged in (limited blast radius), but not the key material itself. For high-value vaults (work notes, journals, anything you don't want a stolen laptop to give up), this is the cheapest meaningful upgrade over a passphrase-protected key on disk.

## Three flavours

| Flavour | Hardware | Best for |
|---|---|---|
| **YubiKey / Nitrokey** (`sk-ssh-ed25519`) | USB FIDO2 token | Cross-machine portability — same key on any laptop with the YubiKey plugged in |
| **macOS Secure Enclave** (`ssh-agent` + `--apple-use-keychain`) | Apple Silicon / T2 chip | macOS-only; touchless re-use after one TouchID prompt |
| **Windows Hello SSH agent** (Win11 24H2+) | TPM | Windows-only; same idea, Windows Hello prompt |

## Recipe 1 — YubiKey (`sk-ssh-ed25519`)

Generate a resident key on the YubiKey:

```bash
# OpenSSH 8.2+ required
ssh-keygen -t ed25519-sk -O resident -O verify-required \
  -C "obsidian-vault@yubikey" \
  -f ~/.ssh/id_ed25519_sk
```

- `-O resident` stores the key handle on the YubiKey itself (so you can re-import on another machine with `ssh-keygen -K`).
- `-O verify-required` forces a touch on every signature — the YubiKey blinks when SSH wants to authenticate.

Copy the public key to the remote:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_sk.pub user@host
```

In the plugin profile:

| Field | Value |
|---|---|
| Authentication | **SSH agent** |
| (no key path needed — the agent has it) |  |

On connect, the YubiKey blinks; touch it. Done.

### Importing on a second machine

```bash
# Plug in the YubiKey, then:
ssh-keygen -K            # extracts the resident key into ~/.ssh/id_ed25519_sk + .pub
ssh-add ~/.ssh/id_ed25519_sk
```

The key handle on the YubiKey is enough to reconstruct the local files. The actual private key never leaves the device.

## Recipe 2 — macOS Secure Enclave

macOS ships an `ssh-agent` that integrates with the keychain + Secure Enclave. The first time you `ssh-add` a key, you can store the passphrase in the keychain (TouchID-gated):

```bash
# Generate a key (or use an existing ed25519)
ssh-keygen -t ed25519 -C "obsidian-vault@mac"

# Add to agent + keychain
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

Persist across reboots — `~/.ssh/config`:

```
Host *
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile ~/.ssh/id_ed25519
```

Now SSH (and the plugin) auth with one TouchID prompt per session. The key material stays in the Secure Enclave; the agent socket is the user-space surface.

### True Secure-Enclave-resident keys (advanced)

If you want the key generated INSIDE the Secure Enclave (so it can never be exported even by a root user), use [Secretive](https://github.com/maxgoedjen/secretive) — open-source app that exposes Secure-Enclave keys via an SSH agent socket. Set `SSH_AUTH_SOCK` to Secretive's socket; everything downstream (including the plugin) just sees `ssh-agent`.

## Recipe 3 — Windows Hello (Win11 24H2+)

Recent Windows builds bundle an `ssh-agent` that integrates with Windows Hello. Enable it:

```powershell
# Run as Administrator
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

Generate a key tied to Windows Hello:

```powershell
# OpenSSH 9.5+ on Windows; use a TPM-backed key
ssh-keygen -t ecdsa -b 256 -f $HOME\.ssh\id_ecdsa_hello
ssh-add $HOME\.ssh\id_ecdsa_hello
```

The PIN/biometric prompt fires on every signature.

In the plugin profile:

| Field | Value |
|---|---|
| Authentication | **SSH agent** |

## Caveats

- **YubiKey USB-A vs USB-C** — the FIDO2 protocol is the same; only the connector differs. The plugin doesn't care.
- **Multi-machine workflow** — `sk-ssh-ed25519` resident keys re-import via `ssh-keygen -K` on each machine; remember to re-add to that machine's agent (`ssh-add ~/.ssh/id_ed25519_sk`).
- **Touch fatigue** — `verify-required` means a touch per RPC round-trip if the agent doesn't cache. The plugin makes many fast RPCs after the initial auth. Most setups cache the signature for the SSH session's lifetime, so you touch once per connect; verify your specific agent's behaviour.
- **CI / unattended use** — hardware-key auth is interactive by design; not suitable for cron jobs that need to ssh in without a human present.

## Verifying it's actually using hardware

```bash
# What's loaded in the agent right now
ssh-add -l
# Should show your hardware-backed key with `(SK)` for sk-* types
# or the keychain origin for macOS

# Force the agent to use ONLY hardware
SSH_AUTH_SOCK=$YUBIKEY_AGENT_SOCK ssh -v user@host 2>&1 | head -30
```

The plugin reads `SSH_AUTH_SOCK` from Obsidian's environment. On macOS/Linux, the agent that started Obsidian is the one used. On Windows + WSL, this is more nuanced — set `SSH_AUTH_SOCK` in the WSL shell that launches Obsidian.

## See also

- [[en/cookbook/ssh-keygen|Generating an SSH key]] — the non-hardware-backed flow + general SSH key concepts
- [[en/user-guide/ssh-config|SSH config & keys]] — how the plugin resolves credentials
- [[en/security/model|Security threat model]] — what hardware-key auth defends against (and what it doesn't)
- [[en/cookbook/share-via-tailscale|Share a vault via Tailscale]] — combine with Tailscale for "hardware-key auth + tailnet-only reach"
