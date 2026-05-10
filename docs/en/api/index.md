---
title: API & protocol
tags: [api, reference]
---

# API & protocol

The wire-level reference for the JSON-RPC protocol the plugin and daemon speak. Useful if you're building something against the daemon (a non-Obsidian client, a load test, a port to a different host) or debugging an unexpected error in a normal session.

> **Stability promise:** the protocol is **frozen at version 1**. Method additions are non-breaking; breaking changes ship as new methods. See [[en/api/protocol-evolution|Protocol evolution]].

## Pages

| Page | What it covers |
|---|---|
| [[en/api/overview\|Overview]] | The shape of every RPC: framing, versioning, capabilities, the auth handshake, and the method namespace |
| [[en/api/authentication\|Authentication]] | The `auth` and `server.info` handshake methods + protocol-version check |
| [[en/api/filesystem\|Filesystem]] | `fs.*` methods: read / write / list / walk / stat / mkdir / remove / rename / thumbnail |
| [[en/api/watch\|fs.watch]] | The push-notification subscription model + inotify caveats |
| [[en/api/errors\|Errors]] | Standard JSON-RPC error codes + the project's domain-specific code range |
| [[en/api/protocol-evolution\|Protocol evolution]] | How the v1 contract evolves; what counts as a breaking change |
| [[en/api/examples\|Examples]] | Copy-pasteable JSON-RPC requests for every method, ready for `nc -U` against a Unix socket |

## Reading order

If you're new to the protocol:

1. **[[en/api/overview|Overview]]** for the big picture (framing + handshake + namespace).
2. **[[en/api/authentication|Authentication]]** to understand what every connection does first.
3. **[[en/api/filesystem|Filesystem]]** for the methods you'll actually call.
4. **[[en/api/errors|Errors]]** when something goes wrong.
5. **[[en/api/examples|Examples]]** for copy-paste recipes.

If you're porting to a new client, also read [[en/api/protocol-evolution|Protocol evolution]] before relying on any specific method's shape.

## See also

- [[en/architecture/index|Architecture]] — the why behind the wire-level decisions
- [[en/reference/daemon-cli|Daemon CLI reference]] — flag set for the binary that speaks this protocol
- [[en/security/model|Security model]] — what the authentication actually defends against
