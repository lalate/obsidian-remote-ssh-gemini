---
title: Token & socket
tags: [security]
---

# Token & socket

The daemon authenticates clients via a shared-secret token read from a file. This page covers the lifecycle and what to worry about.

## What gets generated

At startup, the daemon:

1. Generates 32 random bytes via the OS CSPRNG (`crypto/rand`).
2. Hex-encodes them (64-char string).
3. Writes the token to `--token-file` (default `~/.obsidian-remote/token`) with mode `0600`, owned by the daemon user.
4. Begins listening on `--socket` (default `~/.obsidian-remote/server.sock`).

A new token is generated on every daemon start. Tokens do not survive across daemon restarts.

## Who can read the token

Only the daemon user (mode 0600). Other users on the same host cannot read it without root.

If your remote host has a hostile second user, the token is not a defense — that user could `sudo`, modify the daemon binary, or just read your vault directly. The defense is "trust the OS account boundary", not "secret in a file".

## Connecting clients

The plugin reads the token via SFTP after spawning the daemon, then sends it as the `auth` call's first param. The daemon checks it constant-time-equal against the file contents.

A wrong token closes the connection; no rate-limit (the file mode is the practical defense).

## Socket permissions

The Unix socket itself is mode `0600`. Combined with home-directory permissions (typically 0755), this means same-user processes can connect, other users on the same host cannot connect even before they hit the auth check.

## Token rotation

There is no in-band rotation. The flow:

1. Restart the daemon (`systemctl --user restart obsidian-remote-server` or kill + auto-deploy).
2. New token generated.
3. Plugin re-reads it via SFTP on next connect.

In the auto-deploy flow this is invisible — every connect re-reads the token.

## Defense layers, ranked

1. **OS account boundary** (hostile second user can not reach you).
2. **SSH transport** (network can not see the token even if you typed it).
3. **Token file mode** (other users on same host can not pick the token up off disk).
4. **Token check** (extra layer if all the above fail, e.g. if a sandboxed process under your own user should not be allowed in).

Layer 4 is the weakest — anyone who can read the file IS a "valid" client. The token is "easier than alternative auth schemes for a per-user-process daemon", not "rock-solid against same-user attackers".

Next: [[en/security/host-keys|Host-key trust]].
