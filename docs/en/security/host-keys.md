---
title: Host-key trust
tags: [security]
---

# Host-key trust

obsidian-remote-ssh uses its own known-host store, separate from `~/.ssh/known_hosts`. See [[en/user-guide/host-keys|user guide page]] for how the dialogs look from the user side; this page is the security rationale.

## Why a separate store

Trust is a security-relevant decision. Sharing `~/.ssh/known_hosts` between every SSH-using app on your machine means:

- Adding the plugin silently inherits trust the plugin author never reviewed.
- Removing the plugin does not unwind that trust.
- A compromised app can rewrite `known_hosts` to reroute every other app.

Per-app stores keep trust scoped. The cost: a one-time TOFU prompt for each host the plugin connects to.

## Algorithms

Accepted, in order of preference:

1. `ssh-ed25519` — strongly preferred. Use this on new hosts.
2. `rsa-sha2-512`, `rsa-sha2-256`, `ssh-rsa` — RSA-backed, secure but slower.
3. `ecdsa-sha2-nistp256` / `nistp384` / `nistp521` — fine.

Rejected with no override:

- `ssh-dss` (DSA) — broken cryptographically, deprecated upstream.

## TOFU vs SSHFP / DNSSEC

The plugin does not currently consult SSHFP records (DNS-published host keys). Adding it is on the roadmap; until then, you do TOFU on first connect and trust your own store thereafter. If you have SSHFP available out-of-band, compare manually before clicking "Trust".

## Mismatch handling

The mismatch dialog forces an explicit decision (no "remember this" silent path). The default button is "Cancel". The "Replace stored fingerprint" button only flips in-memory state; it writes to disk only after you confirm.

This is deliberate: a hostile network can race the dialog (typing fast, simulating user clicks via accessibility APIs). The two-step confirm protects against attacks that need a single click.

## Trust-once

Hold Alt + click "Trust" to use the trust-once mode. The fingerprint is held in RAM for the session and never persisted. Useful for probing an unfamiliar host before you commit, diagnostic / debugging sessions, or demos where you do not want trust artifacts left behind.

Trust-once is NOT mismatch-tolerant — if the host key changes mid-session, the next connection still triggers the mismatch flow.

## Manual edits

Host-key trust is persisted under the `hostKeyStore` key in the plugin's `data.json`:

```
<vault>/.obsidian/plugins/remote-ssh/data.json
```

The shape is `{ "<host>:<port>": "<sha256-hex-fingerprint>" }`:

```json
{
  "hostKeyStore": {
    "192.168.1.50:22":      "8d6f0aab...sha256...e1c3",
    "bastion.example.com:22": "abc123de...sha256...4567"
  }
}
```

Edit the file directly to remove or rotate entries outside the plugin (Obsidian must be closed, or it will overwrite on next save).

For full ground-up resync (lost the file, suspect tampering): delete the `hostKeyStore` key. Every host will re-prompt on next connect.

Next: [[en/operations/troubleshooting|Operations — Troubleshooting]].
