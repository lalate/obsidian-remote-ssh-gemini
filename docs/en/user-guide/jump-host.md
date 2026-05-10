---
title: Jump hosts (bastions)
tags: [user-guide]
---

# Jump hosts (bastions)

When the host you want to edit is not directly reachable — it sits behind a bastion / corporate gateway / Tailscale exit node — obsidian-remote-ssh can chain through one or more **jump hosts** (`ssh -J`-style).

## Quick configuration

In a profile, click **Add jump host**:

| Field | Example |
|---|---|
| Jump host | `bastion.example.com` |
| Port | `22` |
| Username | `your-bastion-user` |
| Auth | inherits the profile's credentials by default; per-hop override available |

Multiple hops chain in order: `you → bastion-1 → bastion-2 → target`.

## What gets evaluated

The plugin opens an inner SSH session through the jump chain (analogous to `ssh -J bastion-1,bastion-2 target`). Conceptually:

```
plugin → SSH(bastion-1) → SSH(bastion-2) → SSH(target)
                                           daemon spawn + RPC tunnel
```

Each hop authenticates independently. Each hop's host key is verified independently (and saved into the plugin's known-host store on first trust).

## When jump-hop host keys mismatch

A mismatch on any hop opens a dialog scoped to that hop. Cancel by default unless you have an out-of-band reason to believe the change is legitimate (host migration, rebuild).

## Keeping the jump-chain alive

Long-lived shadow vault sessions can survive transient hop drops:

- The OUTER SSH connection (top-level, you to bastion-1) reconnects on drop with exponential backoff (configurable, see [[en/operations/reconnect|Reconnect]]).
- Inner hops re-establish during the same reconnect attempt.
- The daemon on the target keeps running between reconnects, so the next session resumes without re-uploading the binary.

## Quirks

- **AgentForwarding is not used** by the plugin's chain; each hop authenticates with its own configured credentials. This is deliberate — agent forwarding is a known foot-gun for compromised bastions.
- **Two-factor on a bastion** (Duo, push-prompt) works; expect an extra 1–10s on the first hop while you approve the prompt.
- **Tailscale / WireGuard / Cloudflare Tunnel**: configure as the outermost hop's host. Many users have `target.tailnet-XXX.ts.net` as the direct host with no jump at all — Tailscale hides the chain.

Next: [[en/user-guide/host-keys|Host-key trust details]].
