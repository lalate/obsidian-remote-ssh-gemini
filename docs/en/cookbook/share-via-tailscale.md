---
title: Share a vault via Tailscale
tags: [cookbook, how-to, tailscale]
---

# Share a vault via Tailscale

Goal: a vault on a home Pi (or NAS, VPS) that you and a collaborator both edit from your respective laptops, with no port forwarding and no third-party cloud.

## Why Tailscale

The plugin needs SSH reachability to the host. The default options:

| Approach | Setup | Trade-offs |
|---|---|---|
| Port-forward 22 on your home router | High effort, security-sensitive | Exposes sshd to the public internet |
| Cloudflare Tunnel | Medium effort | Requires CF account + a domain |
| **Tailscale** | Low effort | One install per device, mesh VPN; no public exposure |

For "two laptops + one home server" sharing, Tailscale is the lowest-friction path.

## On the host

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

The `up` command shows a one-time auth URL. Open it, sign into your tailnet (or create one). When the host appears in your tailnet, note its tailscale hostname:

```bash
tailscale status
# host  100.64.0.1   tagged-machine
# alias: obsidian-vault.tailnet-XXXX.ts.net
```

## On each editor's laptop

Install Tailscale (macOS / Windows / Linux installers at [tailscale.com](https://tailscale.com/download)). Sign into the same tailnet.

## Plugin profile

For each editor, in the plugin:

| Field | Value |
|---|---|
| Host | `obsidian-vault.tailnet-XXXX.ts.net` (or the `100.x.y.z` IP) |
| Port | `22` |
| Username | `pi` (or whatever your remote user is) |
| Authentication | SSH agent (recommended) |
| Remote vault path | `/home/pi/notes` |

That's it — no jump host needed. Tailscale provides the path; the plugin sees a normal SSH host.

## Multi-editor caveats

Two people editing the same file at the same time = a conflict. The plugin detects + offers resolution (see [[en/user-guide/conflicts|Conflict handling]]) but you'll want to talk to your collaborator about who owns which area of the vault.

The plugin's per-client `Client ID` keeps your workspace state (open tabs, panes, cursor position) from stomping on each other; see [[en/configuration/this-device|Configuration → This device]].

## ACL hardening (optional)

Tailscale's default policy lets every device in the tailnet reach every other on every port. Lock down to "only laptops can SSH to the vault host" in the [Tailscale ACL editor](https://login.tailscale.com/admin/acls).

```hujson
{
  "groups": {
    "group:editors": ["alice@example.com", "bob@example.com"],
  },
  "tagOwners": {
    "tag:obsidian-vault": ["group:editors"],
  },
  "acls": [
    { "action": "accept", "src": ["group:editors"], "dst": ["tag:obsidian-vault:22"] },
  ],
}
```

Then re-tag the host:
```bash
sudo tailscale up --advertise-tags=tag:obsidian-vault
```

## See also

- [[en/user-guide/jump-host|User guide → Jump hosts]] — for cases where Tailscale isn't an option
- [[en/security/model|Security → Threat model]] — what the plugin defends against (Tailscale stacks neatly under it)
