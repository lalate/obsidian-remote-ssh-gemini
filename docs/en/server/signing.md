---
title: Binary signing
tags: [server, security, deploy]
---

# Binary signing

Every release binary is signed with [Cosign keyless](https://docs.sigstore.dev/cosign/signing/overview/) (Sigstore OIDC) by the GitHub Actions workflow that produced it — no GPG key management, no trust roots to bootstrap. This page covers the publisher side; verifying a binary you downloaded is over at [[en/security/cosign-verify|Cosign verify]].

## What gets signed

For each release tag (bare semver: `X.Y.Z` or `X.Y.Z-beta.N` — no `v` prefix, since the tag is taken straight from `manifest.json.version`):

| Artefact | Signature bundle |
|---|---|
| `obsidian-remote-server-linux-amd64` | `obsidian-remote-server-linux-amd64.bundle` |
| `obsidian-remote-server-linux-arm64` | `obsidian-remote-server-linux-arm64.bundle` |
| `obsidian-remote-server-darwin-amd64` | `obsidian-remote-server-darwin-amd64.bundle` |
| `obsidian-remote-server-darwin-arm64` | `obsidian-remote-server-darwin-arm64.bundle` |
| `daemon-manifest.json` | `daemon-manifest.json.bundle` |

The `daemon-manifest.json` is a `{filename: sha256}` map for all binaries; it's signed separately so a verifier can pin "this is what THIS release's binaries should hash to" with one signature instead of four.

## Identity assertion

Each cosign signature includes a Fulcio certificate naming the GitHub Actions workflow that produced it:

```
identity:    https://github.com/sotashimozono/obsidian-remote-ssh/.github/workflows/release.yml@refs/heads/main
                                                                                              # ^ or refs/heads/next for prereleases
issuer:      https://token.actions.githubusercontent.com
```

`release.yml` triggers on **push** to `main` (stable) or `next` (beta), not on tag-creation, so the identity carries the branch ref the run was triggered from. The `--certificate-identity-regexp` shown in [[en/security/cosign-verify|Cosign verify]] uses `@.*` so both branches match.

This is what you check on verify: "this binary was produced by THIS repo's release workflow on THIS specific commit". Anyone forking the repo and republishing under their own GitHub Actions can sign too — but their identity will be `<their-fork>/.github/workflows/release.yml`, not `sotashimozono/...`. The pinning rejects forks.

## When the plugin auto-deploys

The plugin includes a SHA256 round-trip check (compute locally, `sha256sum` on remote, fail if mismatch). This catches:

- SFTP transport corruption.
- A hostile remote replacing the binary mid-upload.

It does NOT catch a hostile remote that returns the right `sha256sum` for a malicious file (theoretically possible if the remote can decide what `sha256sum` outputs). The next layer of defense is to pre-deploy via [[en/server/systemd|systemd]] with a binary you cosign-verified yourself.

## Reproducible builds

The release pipeline runs `make -C server cross` with a pinned `go-version` (see `.github/workflows/release.yml`). Two consecutive runs of the same commit on the same Go toolchain produce byte-identical binaries — the SHA256 in `daemon-manifest.json` should match what you'd get rebuilding locally with the same Go version and the same commit checked out.

This is a property worth verifying as a contributor before promotion: `make -C server cross && sha256sum dist/* | diff - <(jq -r 'to_entries[] | "\(.value)  \(.key)"' release/daemon-manifest.json)`.

Next: [[en/api/overview|API & protocol]].
