---
title: Contributing
tags: [contributing]
---

# Contributing

How to set up a dev environment, run tests, get a release out, and add docs. The four pages here are everything you need to make and ship a change.

## Pages

| Page | Read when |
|---|---|
| [[en/contributing/development-setup\|Development setup]] | Before your first PR — toolchain, repo layout, common workflows |
| [[en/contributing/testing-strategy\|Testing strategy]] | Before adding tests — what each test layer (unit / integration / E2E) is for |
| [[en/contributing/release-flow\|Release flow]] | When you want to know how your merged PR becomes a published release |
| [[en/contributing/documentation\|Documentation guide]] | When adding or editing pages on this docs site |

## Reading order

For a first-time contributor:

1. **[[en/contributing/development-setup|Development setup]]** — get the build green locally.
2. **[[en/contributing/testing-strategy|Testing strategy]]** — write the right kind of test for your change.
3. Open the PR. The CI on `next` does the rest.
4. **[[en/contributing/release-flow|Release flow]]** — read this once so you know how betas and stable releases differ.

For a docs-only PR, skip straight to **[[en/contributing/documentation|Documentation guide]]**.

## Branching model in one paragraph

`next` is the integration branch — every merge produces a `X.Y.Z-beta.N` release on the BRAT channel. `main` is the stable branch — promotion via a `release/X.Y.Z` PR cuts a stable release on the Obsidian Community Plugins channel. Conventional Commits are enforced; non-conformant PRs are rejected by `commitlint`. Full details in [`CONTRIBUTING.md`](https://github.com/sotashimozono/obsidian-remote-ssh/blob/next/CONTRIBUTING.md) and [[en/contributing/release-flow|Release flow]].

## See also

- [`CONTRIBUTING.md`](https://github.com/sotashimozono/obsidian-remote-ssh/blob/next/CONTRIBUTING.md) — canonical short-form contributor reference (kept in sync with these pages)
- [[en/architecture/release-pipeline|Release & deploy pipeline]] — system view of what CI does behind the release flow
- [[en/api/protocol-evolution|Protocol evolution]] — the rules a wire-protocol change must follow
