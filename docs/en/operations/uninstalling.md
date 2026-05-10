---
title: Uninstalling
tags: [operations, uninstall]
description: "Cleanly uninstall obsidian-remote-ssh: 4 levels from disable-only to full local + remote scrub. What gets removed at each level and what your vault never touches."
---

# Uninstalling

The plugin doesn't touch system files, so a clean uninstall is straightforward. Pick the depth you want — disable-only, full local removal, or full local + remote scrub.

## Level 1 — disable the plugin (reversible)

Settings → Community plugins → toggle "Remote SSH" off.

The plugin stops loading. Your shadow vault windows close. The daemon on the remote keeps running for a while (until the daemon-side process is killed or the host reboots) but doesn't accept new connections from this plugin. Re-enable to bring it back; profiles, host-key trust, and BRAT subscription stay intact.

## Level 2 — uninstall the plugin (local cleanup)

Settings → Community plugins → "Remote SSH" → **Uninstall**.

This deletes `<vault>/.obsidian/plugins/remote-ssh/` — the bundle, settings, host-key store, logs, telemetry, and bundled daemon binary. Profiles are gone. Host-key trust is gone (a future re-install will re-prompt TOFU on every host).

Also delete the local shadow vaults (Obsidian doesn't know about them):

```bash
# Linux / macOS / WSL
rm -rf ~/.obsidian-remote/vaults/

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:USERPROFILE\.obsidian-remote\vaults\"
```

Do this for **every** host's vault root if you have multiple profiles — the directory is keyed by `<profile-id>`, one subdirectory per profile.

If you uninstalled BRAT to remove the beta channel as well, that's a separate Settings → Community plugins → BRAT → Uninstall.

## Level 3 — scrub the remote host(s)

For each host you ever connected to:

```bash
ssh user@host
pkill -f obsidian-remote-server      # stop the daemon
rm -rf ~/.obsidian-remote/           # delete daemon binary + token + socket + log
```

If you ran the daemon under [[en/cookbook/systemd-managed-daemon|systemd]]:

```bash
systemctl --user disable --now obsidian-remote-server
rm ~/.config/systemd/user/obsidian-remote-server.service
sudo rm -f /usr/local/bin/obsidian-remote-server
systemctl --user daemon-reload
```

Optionally remove the linger setting if you enabled it:

```bash
sudo loginctl disable-linger $USER
```

## Level 4 — vault data (rarely wanted)

The plugin **never modifies the structure of your vault** — your notes are at whatever path you set as **Remote vault path**. Removing the plugin does NOT delete your notes. To wipe the vault too:

```bash
ssh user@host 'rm -rf ~/notes'   # or whatever path you used
```

Make sure you have a backup first; this is irreversible.

## What the plugin doesn't touch

- `~/.ssh/` (your SSH keys + config) — never modified
- `~/.ssh/known_hosts` — never read or written by the plugin (it has its own store)
- System packages, init scripts, anything in `/etc/`, anything in `/usr/` — except `/usr/local/bin/obsidian-remote-server` if you put it there yourself per [[en/cookbook/systemd-managed-daemon|systemd recipe]]

So a Level 3 scrub leaves your remote host in the same state it was before you installed.

## Verifying nothing's left

```bash
# Local
ls "<vault>/.obsidian/plugins/" | grep -i remote-ssh    # should print nothing
ls ~/.obsidian-remote/vaults/ 2>/dev/null               # should print nothing

# Each remote
ssh user@host 'ls -la ~/.obsidian-remote/ 2>/dev/null'  # should print nothing or "no such file"
ssh user@host 'pgrep -f obsidian-remote-server'         # should print nothing (no PID)
```

## Re-installing later

If you re-install the plugin against the same host(s):

- Profile list will be empty (rebuild from scratch)
- Host-key store will be empty (TOFU prompt fires on first connect to each host)
- Daemon redeploys fresh on first connect (the previous binary + token are gone)

Vault data picks up where you left off because that lived on the remote untouched.

## See also

- [[en/privacy|Privacy & data handling]] — full inventory of where the plugin writes
- [[en/faq|FAQ]] — quick answers including the short uninstall summary
- [[en/cookbook/systemd-managed-daemon|systemd-managed daemon]] — relevant for Level 3 systemd cleanup
