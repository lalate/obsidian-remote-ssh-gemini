---
title: Security
tags: [security]
---

# Security

The threat model and the mechanisms that defend against it. Read [[en/security/model|the threat model]] first — the other pages are the moving parts that implement it.

## Pages

| Page | What it covers |
|---|---|
| [[en/security/model\|Threat model]] | Who we defend against, what guarantees we make, what is explicitly out of scope |
| [[en/security/host-keys\|Host-key trust]] | The plugin's own known-hosts store (separate from `~/.ssh/known_hosts`), the trust dialog, and host-key rotation |
| [[en/security/token\|Token handling]] | The 32-byte daemon session token: generation, on-disk lifecycle, what happens on a leak |
| [[en/security/cosign-verify\|Cosign verify]] | Sigstore keyless verification of the daemon binary you downloaded — what the workflow signs, how to check it |

## Reading order

1. **[[en/security/model|Threat model]]** — every other page assumes you've read this.
2. **[[en/security/host-keys|Host-key trust]]** — the most user-facing part of the security surface.
3. **[[en/security/token|Token handling]]** + **[[en/security/cosign-verify|Cosign verify]]** — operator-facing details that complete the picture.

## See also

- [[en/api/authentication|API → Authentication]] — the wire-level auth handshake (uses the token from [[en/security/token|Token handling]])
- [[en/architecture/release-pipeline|Release pipeline]] — how the daemon binary gets signed in CI
- [[en/privacy|Privacy & data handling]] — adjacent topic; what data flows where, separate from "what the system defends against"

## Reporting a vulnerability

GitHub Security Advisories: [obsidian-remote-ssh/security/advisories/new](https://github.com/sotashimozono/obsidian-remote-ssh/security/advisories/new). Coordinated disclosure preferred.
