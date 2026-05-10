---
title: Roadmap
tags: [roadmap, project]
---

# Roadmap

Distilled from the live tracking issues. The authoritative source is always [GitHub issues](https://github.com/sotashimozono/obsidian-remote-ssh/issues) — this page reflects the state at last edit.

## Where we are

**Plugin**: BRAT-distributed beta (current `next` channel). The full shadow-vault architecture is operational, the daemon binary set is signed, BRAT users are running it day-to-day.

**Submission to Obsidian Community Plugins**: PR open at [obsidianmd/obsidian-releases#12390](https://github.com/obsidianmd/obsidian-releases/pull/12390). Awaiting Obsidian team review.

## What's left before v1.0

Tracked in [#126](https://github.com/sotashimozono/obsidian-remote-ssh/issues/126).

| Item | Status |
|---|---|
| **Public bug bash** — solicit BRAT testers via Obsidian Discord/forum, target ≥10 external installs + real-world bug reports | Open |
| **Beta success-metric review** — 2 weeks of BRAT distribution with no P0 bugs = green light | Open (gates on bug bash) |
| **CI gate switches** — flip `PERF_GATE` to enforcing once nightly baseline stabilises; tighten coverage gate; flip gosec/trivy from informational to blocking | Open (#110) |
| Settings UI rework, status bar, onboarding wizard | Done (Phase F) |
| Telemetry opt-in, manifest-beta, BRAT distribution | Done (Phase G — F22, F23) |
| README polish, animated GIF demo, Community Plugins submission | Done (Phase H — F30, #236, #242, #251) |

Estimated remaining PR count: 3-5 small ones to flip the CI gates + close the bug-bash loop.

## v2.0 — mobile (long-term)

Tracked in [#151](https://github.com/sotashimozono/obsidian-remote-ssh/issues/151). **Deferred until v1.x has shipped + stabilised; do not pick up before then.**

The current architecture spawns a daemon binary on the remote, which works on desktop where Obsidian is Electron + has Node `net.Socket` + the `ssh2` library. Mobile (iOS / Android Obsidian) is a Capacitor WebView — no Node networking, no native binaries. The only network primitive is HTTPS / WSS.

**Plan in outline:**
- **Daemon**: add a WSS listener (TLS via Let's Encrypt or self-signed). Same JSON-RPC dispatcher behind it — `fs.*` etc. work unchanged.
- **Plugin**: a new `WSSTransport` implementing the same `Transport` interface as `RpcRemoteFsClient`. Auth via API token (rotated, scoped) instead of SSH keys.
- **Mobile UX**: audit which existing UI assumes desktop (window-spawning, terminal pane) and gate.
- **Manifest**: flip `isDesktopOnly: false` only after WSS path is hardened end-to-end.

This is a second transport, not a tweak — meaningful new surface area, scheduled appropriately.

## Closed scope (won't fix soon)

- **Single-vault concurrent mobile + desktop sessions** — deferred until v1.1+.
- **Native Windows daemon** — daemon binaries today are Linux + macOS; remote on Windows works via WSL. No active plan to add a native Windows build.

## How to influence the roadmap

- **Bug reports** that affect the bug-bash gate are the highest-leverage way to shape v1.0 timing.
- **Use cases that bend the architecture** (multi-vault, large vaults > 100k files, exotic SSH setups) are valuable — open a discussion or issue with concrete numbers.
- **PRs welcome** — the [Phase F/G items in #126](https://github.com/sotashimozono/obsidian-remote-ssh/issues/126) marked `[ ]` are the most direct way to land contributions.

## See also

- Recent releases: [GitHub Releases](https://github.com/sotashimozono/obsidian-remote-ssh/releases)
- Branching model + how releases get cut: [`CONTRIBUTING.md` → Branching model](https://github.com/sotashimozono/obsidian-remote-ssh/blob/next/CONTRIBUTING.md#branching-model--next-beta--main-stable)
