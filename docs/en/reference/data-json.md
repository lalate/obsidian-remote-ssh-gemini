---
title: data.json schema reference
tags: [reference, settings, data]
---

# `data.json` schema reference

Complete schema for `<vault>/.obsidian/plugins/remote-ssh/data.json` — the file that holds your profiles, host-key trust, and plugin settings. Useful for debugging, scripted multi-machine setup, or rebuilding state by hand.

> Source of truth: `plugin/src/types.ts` (`PluginSettings`, `SshProfile`, `JumpHostConfig`) plus `plugin/src/main.ts:311-326` (the `hostKeyStore` field added when serialising). If anything below disagrees with the source, the source wins.

## Top-level shape

```jsonc
{
  // PluginSettings fields (see below for each)
  "profiles": [...],
  "activeProfileId": "...",
  "enableDebugLog": false,
  "maxLogLines": 1000,
  "reconnectMaxRetries": 5,
  "clientId": "",
  "userName": "",
  "onboardingCompleted": true,
  "telemetryEnabled": false,
  "terminalShell": "/usr/bin/zsh -l",
  "terminalFontSize": 12,
  "terminalScrollback": 1000,

  // Added by main.ts at save time (NOT in PluginSettings)
  "hostKeyStore": {
    "192.168.1.50:22": "aa:bb:cc:dd:..."
  }
}
```

## Top-level fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `profiles` | `SshProfile[]` | `[]` | One entry per connection target; see profile schema below |
| `activeProfileId` | `string \| null` | `null` | Last-connected profile, restored on plugin reload |
| `enableDebugLog` | `boolean` | `false` | Verbose logging to `console.log` (UI: Settings → Advanced) |
| `maxLogLines` | `number` | (legacy field; the size-rotated `console.log` makes it informational) | Pre-Phase-D upper-bound; leave as default |
| `reconnectMaxRetries` | `number` | `5` (Backoff.DEFAULT_BACKOFF.maxRetries) | 0 disables auto-reconnect; range 0-100 |
| `clientId` | `string` | `""` (= sanitized OS hostname at runtime) | Per-device id; surfaces as `.obsidian/user/<id>/` on the remote |
| `userName` | `string` | `""` (= OS username at runtime) | Display name only; not used for SSH auth |
| `onboardingCompleted` | `boolean?` | `false` | First-launch flag; once true, the OnboardingModal won't auto-open |
| `telemetryEnabled` | `boolean?` | `false` | Opt-in counters → `<plugin>/telemetry.jsonl` |
| `terminalShell` | `string?` | (use remote `$SHELL`) | Override for the terminal pane's shell command |
| `terminalFontSize` | `number?` | `12` | xterm.js font size, range 6-32 |
| `terminalScrollback` | `number?` | `1000` | In-memory line buffer (not persisted across re-opens) |
| `autoConnectProfileId` | `string?` | (unset) | Set by `ShadowVaultBootstrap` on shadow vaults; auto-connects on layout-ready. **Don't set on a regular vault.** |
| `pendingPluginSuggestions` | `PendingPluginSuggestion[]?` | (unset) | Shadow-vault-only; suggestions for which community plugins to install on first bootstrap. Cleared once decided. |
| `hostKeyStore` | `Record<string, string>` | `{}` | Map `host:port` → sha256-hex fingerprint. Added by `main.ts` at save. See [[en/security/host-keys\|Host-key trust]]. |

## `SshProfile` schema

Every entry in `profiles[]` matches:

```jsonc
{
  "id": "abc-123-uuid",          // generated on profile creation; do not change
  "name": "My Pi",               // display label

  // Identification
  "host": "192.168.1.50",
  "port": 22,
  "username": "pi",

  // Authentication
  "authMethod": "privateKey",    // "password" | "privateKey" | "agent"
  "privateKeyPath": "~/.ssh/id_ed25519",  // for "privateKey"
  "passphraseRef": "...",        // SecretStore handle for the passphrase
  "agentSocket": "/path/to/sock",        // override SSH_AUTH_SOCK; rare
  "passwordRef": "...",          // SecretStore handle if "password" auth

  // Remote vault
  "remotePath": "/home/pi/notes",

  // Transport
  "transport": "sftp",           // "sftp" (default) | "rpc"
  "rpcSocketPath": ".obsidian-remote/server.sock",
  "rpcTokenPath": ".obsidian-remote/token",

  // SSH session tuning (sane defaults; rarely changed)
  "connectTimeoutMs": 15000,
  "keepaliveIntervalMs": 30000,
  "keepaliveCountMax": 3,

  // Host key (Phase 2 only — superseded by hostKeyStore for v1)
  "hostKeyFingerprint": "...",   // legacy per-profile pin

  // Optional jump host
  "jumpHost": {
    "host": "bastion.example.com",
    "port": 22,
    "username": "jump-user",
    "authMethod": "agent",
    "privateKeyPath": "~/.ssh/bastion_key",  // if authMethod === "privateKey"
    "passwordRef": "..."         // if authMethod === "password"
  }
}
```

### Field-by-field

| Field | Type | Required? | Notes |
|---|---|:-:|---|
| `id` | string | yes | UUID-shape; the plugin generates this on `Add profile`. **Don't edit by hand** — it keys the shadow vault directory under `~/.obsidian-remote/vaults/<id>/`. |
| `name` | string | yes | Display only; safe to rename anytime |
| `host` | string | yes | Hostname / IP / SSH-config alias |
| `port` | number | yes | Defaults to 22 in the UI |
| `username` | string | yes | Remote SSH user |
| `authMethod` | enum | yes | One of `password`, `privateKey`, `agent` |
| `privateKeyPath` | string | when `authMethod === 'privateKey'` | `~`-expanded at runtime |
| `passphraseRef` | string | when key has a passphrase + you stored it | Opaque handle from SecretStore (OS keychain) |
| `agentSocket` | string | rarely | Override of `SSH_AUTH_SOCK`; usually leave unset |
| `passwordRef` | string | when `authMethod === 'password'` + you stored it | Same SecretStore mechanism |
| `remotePath` | string | yes | Vault root on the remote; `~`-expanded |
| `transport` | enum | no, default `sftp` | Switch to `rpc` to opt into the daemon |
| `rpcSocketPath` | string | no, default `.obsidian-remote/server.sock` | Home-relative path on the remote |
| `rpcTokenPath` | string | no, default `.obsidian-remote/token` | Home-relative path on the remote |
| `connectTimeoutMs` | number | no | SSH handshake timeout |
| `keepaliveIntervalMs` | number | no | SSH keepalive cadence |
| `keepaliveCountMax` | number | no | Drop after N missed keepalives |
| `hostKeyFingerprint` | string | no | **Legacy.** Pre-1.0 per-profile pin; superseded by the global `hostKeyStore`. New profiles don't set this. |
| `jumpHost` | `JumpHostConfig` | no | Single jump host for now (multi-hop tracked separately) |

## `JumpHostConfig` schema

```jsonc
{
  "host": "bastion.example.com",
  "port": 22,
  "username": "jump-user",
  "authMethod": "agent",          // same enum as profile
  "privateKeyPath": "...",        // if applicable
  "passwordRef": "..."            // if applicable
}
```

Each jump host authenticates independently. See [[en/user-guide/jump-host|Jump hosts]] for the model.

## `hostKeyStore`

The plugin's own known-host store, **separate from `~/.ssh/known_hosts`**. Map of `"<host>:<port>"` → sha256-hex fingerprint:

```jsonc
{
  "hostKeyStore": {
    "192.168.1.50:22": "aa:bb:cc:dd:ee:ff:01:02:03:04:05:06:07:08:09:0a:0b:0c:0d:0e:0f:10:11:12:13:14:15:16:17:18:19:1a",
    "bastion.example.com:22": "ab:cd:ef:..."
  }
}
```

The fingerprint format is the same colon-separated bytes shown in the host-key trust dialog (no `SHA256:` prefix). See [[en/security/host-keys|Host-key trust]] for the trust model + manual edits.

## Hand-editing safely

Obsidian must be **closed** when you edit `data.json` directly — the plugin saves over it on shutdown.

After edits, re-open Obsidian. The plugin's load path (`main.ts:311+`) reads the file as a `Partial<PluginSettings> & { hostKeyStore? }`, so missing fields revert to defaults rather than crashing.

Common safe operations:
- Reorder `profiles[]`
- Rename `profiles[i].name`
- Update `profiles[i].host` / `port` / `remotePath`
- Remove a stale `hostKeyStore` entry to force re-trust

Unsafe operations (don't do these):
- Change `profiles[i].id` (would orphan the shadow vault directory)
- Edit `hostKeyStore` to a fingerprint you didn't actually verify (defeats the purpose)
- Add fields not in this schema (silently dropped on next save)

## What's NOT in `data.json`

- **Passwords / passphrases themselves** — stored in OS keychain via SecretStore; `data.json` only has opaque handles
- **The actual SSH private keys** — read fresh from `~/.ssh/...` on every connect
- **Logs / telemetry** — separate files (`console.log`, `telemetry.jsonl`)
- **The shadow vault contents** — physically separate vaults under `~/.obsidian-remote/vaults/<id>/`

## See also

- [[en/configuration/profiles|Profiles configuration reference]] — UI-level walkthrough of the same fields
- [[en/security/host-keys|Host-key trust]] — `hostKeyStore` security model
- [[en/configuration/this-device|This device]] — `clientId` / `userName` semantics
- [[en/privacy|Privacy & data handling]] — full inventory of where the plugin writes
