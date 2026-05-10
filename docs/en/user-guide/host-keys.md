---
title: Host keys & trust
tags: [user-guide, security]
---

# Host keys & trust

obsidian-remote-ssh maintains its **own known-host store**, independent of `~/.ssh/known_hosts`. This page explains the trust model and what each dialog means.

## Why a separate store

OpenSSH's `known_hosts` is shared across every `ssh` invocation on your machine. The plugin's separate store keeps trust scoped to the plugin — adding the plugin does not suddenly trust hosts your shell SSH already knew, and removing the plugin does not leave orphan trust elsewhere.

The store lives in the plugin's `data.json` under the `hostKeyStore` key. See [[en/security/host-keys#manual-edits|Security → Host-key trust → Manual edits]] for the on-disk format.

## First-connect (TOFU) flow

When you first connect to a host (or a jump host) that is not in the store:

```
Trust new host?
  <host>:<port>
  Key type: ssh-ed25519
  Fingerprint (sha256): aa:bb:cc:dd:ee:ff:01:02:…

[ Reject ]   [ Trust this session only ]   [ Trust & remember ]
```

The fingerprint is the colon-separated SHA-256 of the host key (no `SHA256:` prefix; that's OpenSSH's display style, not this dialog's). Pick:

- **Reject** — abort the connect; nothing persisted.
- **Trust this session only** — trust held in RAM, dropped on disconnect.
- **Trust & remember** — write to `data.json`'s `hostKeyStore` for silent future use.

A mismatch on a known host opens a different dialog (next section).

## Mismatch flow

If the host key changes after you've trusted it:

```
Host key MISMATCH for <host>:<port>

Pinned fingerprint (sha256):
  aa:bb:cc:…  (the one you previously trusted)

Presented fingerprint (sha256):
  ef:01:23:…  (the one the host is offering now)

This usually means the remote OS was reinstalled, the SSH server
was rebuilt, or you are being intercepted (man-in-the-middle).

[ Reject ]   [ Trust this session only ]   [ Replace pinned fingerprint ]
```

**Default to Reject** unless you have an out-of-band reason to believe the change is legitimate. If it IS legit (e.g., you reinstalled your Pi):

1. Verify the new fingerprint via a different channel — log in via console / serial / Tailscale exec / your provider's web console and run:
   ```bash
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}'
   # → SHA256:base64-blob (note: ssh-keygen formats as base64;
   #   the plugin shows the same hash as colon-separated bytes)
   ```
2. Compare both representations against the "Presented fingerprint" line.
3. Click "Replace pinned fingerprint" only if they match.

## Trust-once override

For experimental / one-off connections (testing a new server, debugging a colleague's box) you can trust **for the current session only**. The fingerprint is held in memory and discarded on disconnect — nothing written to disk.

Use the **Trust this session only** button in the trust dialog. The fingerprint is dropped on disconnect.

## Manual store editing

The on-disk format and edit instructions are in [[en/security/host-keys#manual-edits|Security → Host-key trust → Manual edits]] (the same `hostKeyStore` key in the plugin's `data.json`).

## Algorithms supported

- `ssh-ed25519` (preferred — recommend you use this on new hosts)
- `rsa-sha2-512`, `rsa-sha2-256`, `ssh-rsa` (RSA keys, in order of preference)
- `ecdsa-sha2-nistp256/384/521` (ECDSA keys)

DSA keys (`ssh-dss`) are explicitly rejected — they are deprecated upstream in OpenSSH and broken cryptographically.

Next: [[en/user-guide/conflicts|Conflict handling]].
