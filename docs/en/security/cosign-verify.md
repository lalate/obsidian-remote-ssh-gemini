---
title: Cosign verify
tags: [security]
---

# Cosign verify

Every release binary is signed with [Cosign keyless](https://docs.sigstore.dev/cosign/signing/overview/) (Sigstore OIDC). The signature proves the binary was produced by **this** repo's release workflow on **this** specific commit — without any GPG key management on either side.

## Install cosign

```bash
# macOS
brew install cosign

# Linux
curl -sLO https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
sudo install cosign-linux-amd64 /usr/local/bin/cosign

# Windows (scoop)
scoop install cosign
```

## Verify one binary

Download the binary AND its `.bundle` from the release, then:

```bash
cosign verify-blob \
  --bundle obsidian-remote-server-linux-amd64.bundle \
  --certificate-identity-regexp \
    'https://github.com/sotashimozono/obsidian-remote-ssh/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  obsidian-remote-server-linux-amd64
```

Output on success:
```
Verified OK
```

A failure looks like:
```
Error: failed to verify signature ... certificate identity does not match
```

## What the verify checks

The cosign signature carries a Fulcio-issued certificate that asserts:

- **Identity**: the GitHub Actions workflow that ran (`.github/workflows/release.yml@refs/heads/main` for stable releases, `@refs/heads/next` for prereleases — the workflow triggers on push to a branch, not tag-creation).
- **Issuer**: GitHub Actions' OIDC provider (`token.actions.githubusercontent.com`).

The `--certificate-identity-regexp` you pass anchors the verification to **this** repo. Anyone forking and re-signing under their own GitHub Actions can sign too — but their identity will be `<their-fork>/.github/workflows/release.yml`, not `sotashimozono/...`. The regex pin rejects forks.

## Verify everything in one shot

The `daemon-manifest.json` is a `{filename: sha256}` map for all binaries in a release. Verify the manifest, then check each binary's hash:

```bash
cosign verify-blob \
  --bundle daemon-manifest.json.bundle \
  --certificate-identity-regexp \
    'https://github.com/sotashimozono/obsidian-remote-ssh/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  daemon-manifest.json

sha256sum -c <(jq -r 'to_entries[] | "\(.value)  \(.key)"' daemon-manifest.json)
```

## Plugin-side verification (built in)

When the plugin auto-deploys a binary, it computes the local SHA256, runs `sha256sum` on the remote post-upload, and aborts the connect if they do not match. Catches transport corruption + on-the-wire tampering. Does NOT replace cosign verification — `sha256sum` on a hostile remote can lie. The strongest path is:

1. Download the release binaries + bundles to a trusted machine.
2. `cosign verify-blob` everything.
3. Pre-deploy via [[en/server/systemd|systemd]] using the verified binary.
4. Configure the plugin profile to attach to the systemd-managed daemon.

For most users, the auto-deploy + plugin SHA256 round-trip is enough.

## Why keyless

- No long-lived signing keys to rotate, leak, lose.
- Signatures are tied to the workflow identity (audit-able on Sigstore's transparency log).
- Anyone can verify with no upfront trust setup beyond knowing the repo identity.

The trade-off: trust roots in GitHub Actions + Sigstore's PKI. If either is fully compromised, signatures from that period would be suspect — Sigstore publishes its incident log so you can reason about windows.

Next: [[en/security/token|Token & socket]].
