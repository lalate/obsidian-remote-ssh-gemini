---
title: Privacy & data handling
tags: [privacy, security]
description: "obsidian-remote-ssh privacy and data-handling: where files live (only your remote), what's logged, opt-in telemetry, no third-party network calls, full data inventory."
---

# Privacy & data handling

Plain answers about what data this plugin handles, where it lives, and what does (or does not) leave your machines. The plugin does not phone home; this page is the receipts.

## What never leaves your environment

- **Vault contents** — your notes live on YOUR remote host and are read/written via YOUR SSH session. No third party touches them.
- **SSH credentials** — keys stay in `~/.ssh/`. The plugin reads them at connect time; nothing copied into plugin storage.
- **Authentication tokens** — the daemon's per-session token (`~/.obsidian-remote/token` on the remote) is generated locally on the daemon, read by the plugin via SFTP, and never sent anywhere else.
- **Host fingerprints** — your `data.json` `hostKeyStore` is local-only.
- **Telemetry data** — see below; opt-in, file-only, never networked.

## Network traffic

| Protocol | Endpoint | When |
|---|---|---|
| **SSH** | Your remote host (you configured the address) | Every connect; carries SFTP + the RPC tunnel |
| **HTTPS** to GitHub | `github.com` / `objects.githubusercontent.com` | Manual install: when you download release binaries. BRAT: at startup if BRAT auto-update fires (BRAT is a separate plugin, behaves per its own settings) |
| **HTTPS** to Sigstore (Fulcio + Rekor) | `*.sigstore.dev` | Only if you run `cosign verify-blob` yourself; the plugin itself doesn't call out to Sigstore |

The plugin's process makes **zero unsolicited outbound connections**. There's no analytics endpoint, no telemetry beacon, no update-check ping (the manifest update check is Obsidian's own, not ours).

## Telemetry — opt-in, local-only

Telemetry is **off by default**. Enable in **Settings → Telemetry**.

When on, the plugin records two event kinds to a local file (`<vault>/.obsidian/plugins/remote-ssh/telemetry.jsonl`):

| Event kind | Fields |
|---|---|
| `error` | `category` (auth / rpc / conflict / …), optional `code` |
| `reconnect` | `state` (`idle` / `waiting` / `attempting` / `recovered` / `failed` / `cancelled`) |

**No vault content, no SSH credentials, no host names, no IPs are recorded** — just bucket-counted error categories useful for your own diagnosis. There is no "send" button or background uploader. The data is yours; nuke the file when you don't need it.

## Logs

| Log | Location | What's in it |
|---|---|---|
| Plugin (client) | `<vault>/.obsidian/plugins/remote-ssh/console.log` | Operational lines mirroring Obsidian's developer console. Contains profile names, paths, error messages. Rotated by size: 5 MB × 4 files (`.log` + `.1` + `.2` + `.3`). |
| Daemon (server) | `~/.obsidian-remote/server.log` on the remote | Daemon stdout/stderr. Contains paths + RPC method names. Truncated on each daemon restart. |
| systemd journal | (if you run via systemd) `journalctl --user -u obsidian-remote-server` | Same content as the daemon log; managed by systemd's retention policy |

**Debug logging** (off by default; toggle in **Settings → Advanced**) makes the plugin log significantly more verbose. Useful for [[en/operations/troubleshooting|troubleshooting]]; remember to turn it off afterwards.

Logs do not include vault file contents. They do include vault-relative file paths in error contexts — e.g. "fs.write failed: notes/draft.md / EACCES". If your file paths themselves are sensitive, treat the logs as sensitive.

## At-rest disk locations

A complete inventory of what this plugin writes to disk:

### On your local machine (laptop)

```
<vault>/.obsidian/plugins/remote-ssh/
    main.js, manifest.json, styles.css     # plugin bundle
    server-bin/obsidian-remote-server-*    # bundled daemon binary (signed)
    data.json                              # profiles + hostKeyStore + settings
    console.log[.1-.3]                     # operational log
    telemetry.jsonl                        # opt-in counters

~/.obsidian-remote/vaults/<profile-id>/    # local shadow vault per profile
                                           # (mirrors remote files for Obsidian)
```

### On the remote host

```
~/.obsidian-remote/
    server          # daemon binary (uploaded from plugin)
    server.sock     # Unix socket (mode 0600)
    token           # 32-byte token (mode 0600)
    server.log      # daemon stdout/stderr

<configured-vault-root>/                   # YOUR notes, untouched in shape
```

The plugin **never writes outside `~/.obsidian-remote/` and the configured vault root** on the remote. The shadow vault on your local machine is regenerated automatically and contains a cached copy of remote files you've opened.

## What about Obsidian Sync / iCloud / Dropbox?

This plugin is not Obsidian Sync — there's no third-party cloud involved at all. If you have Obsidian Sync ALSO enabled on the same vault, the two will fight (one wins last-write); pick one. iCloud / Dropbox / OneDrive folders for your `.obsidian/` directory work fine in parallel since this plugin only touches its own subdirectory under `plugins/remote-ssh/`.

## Removing all traces

See [[en/operations/uninstalling|Uninstalling]] for the complete scrub.

## See also

- [[en/security/model|Security threat model]] — what the plugin defends against (and what it doesn't)
- [[en/security/token|Token & socket]] — daemon authentication details
- [[en/security/host-keys|Host-key trust]] — fingerprint store internals
- [[en/operations/logs|Logs & telemetry]] — operational view of the same files described here
