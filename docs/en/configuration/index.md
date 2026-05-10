---
title: Configuration
tags: [configuration, reference]
---

# Configuration

Every plugin setting, documented. The pages here mirror the structure of **Settings → Remote SSH** inside Obsidian.

## Pages

| Page | Mirrors UI section |
|---|---|
| [[en/configuration/profiles\|Profiles]] | **Settings → Remote SSH → SSH profiles** — per-profile host / port / auth / vault path / mode / jump host |
| [[en/configuration/this-device\|This device]] | **Settings → Remote SSH → This device** — `Client ID`, `User name`, the per-client workspace partition |
| [[en/configuration/advanced\|Advanced]] | **Settings → Remote SSH → Advanced** — debug log toggle, reconnect retries, edge-case knobs |
| [[en/configuration/terminal\|Terminal]] | xterm.js panel: shell command, font size, scrollback |

## Where settings live

```
<vault>/.obsidian/plugins/remote-ssh/data.json
```

The on-disk schema is documented at **[[en/reference/data-json|data.json schema reference]]** — read that page if you want to script multi-machine setup or edit the file by hand.

## See also

- [[en/reference/data-json|data.json schema reference]] — the on-disk format behind the UI
- [[en/security/host-keys|Host-key trust]] — the `hostKeyStore` field is added at save time, separate from per-profile settings
- [[en/getting-started/first-connect|First connect]] — when each setting first matters
