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
Connect to <host>:<port>?
  Algorithm: ssh-ed25519 (or rsa-sha2-512 / ecdsa-…)
  Fingerprint: SHA256:8d6F…
[ Trust this fingerprint ]   [ Cancel ]
```

Trusting writes the entry. A mismatch on a known host opens a different dialog (next section).

## Mismatch flow

If the host key changes after you've trusted it:

```
WARNING: Host key MISMATCH for <host>:<port>
  Stored:    ssh-ed25519 SHA256:OldFP…
  Received:  ssh-ed25519 SHA256:NewFP…

This usually means the remote OS was reinstalled, the SSH server
was rebuilt, or you are being intercepted (man-in-the-middle).

[ Cancel ]   [ Replace stored fingerprint ]
```

**Default to Cancel** unless you have an out-of-band reason to believe the change is legitimate. If it IS legit (e.g., you reinstalled your Pi):

1. Verify the new fingerprint via a different channel — log in via console / serial / Tailscale exec / your provider's web console and run:
   ```bash
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```
2. Compare with the dialog's "Received" line.
3. Click "Replace stored fingerprint" only if they match.

## Trust-once override

For experimental / one-off connections (testing a new server, debugging a colleague's box) you can trust **for the current session only**. The fingerprint is held in memory and discarded on disconnect — nothing written to disk.

In the trust dialog, hold Alt while clicking "Trust" to use the trust-once mode.

## Manual store editing

The on-disk format and edit instructions are in [[en/security/host-keys#manual-edits|Security → Host-key trust → Manual edits]] (the same `hostKeyStore` key in the plugin's `data.json`).

## Algorithms supported

- `ssh-ed25519` (preferred — recommend you use this on new hosts)
- `rsa-sha2-512`, `rsa-sha2-256`, `ssh-rsa` (RSA keys, in order of preference)
- `ecdsa-sha2-nistp256/384/521` (ECDSA keys)

DSA keys (`ssh-dss`) are explicitly rejected — they are deprecated upstream in OpenSSH and broken cryptographically.

Next: [[en/user-guide/conflicts|Conflict handling]].
