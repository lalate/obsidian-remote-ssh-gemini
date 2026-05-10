---
title: Reference
tags: [reference]
---

# Reference

Mechanical reference material — flag sets, schemas, the things you look up rather than read end-to-end.

## Pages

| Page | When to use |
|---|---|
| [[en/reference/daemon-cli\|Daemon CLI reference]] | Running `obsidian-remote-server` by hand: full flag set, state-dir layout, exit codes, signal handling |
| [[en/reference/data-json\|data.json schema reference]] | Editing the plugin's `data.json` directly or scripting multi-machine setup: `PluginSettings`, `SshProfile`, `JumpHostConfig`, `hostKeyStore` |

## What's NOT here

- **API/protocol reference** lives at **[[en/api/index|API & protocol]]** — separate section because it has its own structure.
- **Per-setting UI walkthroughs** live at **[[en/configuration/index|Configuration]]** — same fields, but documented from the UI's POV.
- **Error code list** lives at **[[en/api/errors|API → Errors]]** alongside the rest of the protocol docs.

This section exists for the things that don't fit those — currently the daemon binary's CLI surface and the on-disk settings file.

## See also

- [[en/api/index|API & protocol]] — the JSON-RPC reference
- [[en/configuration/index|Configuration]] — UI walkthroughs of the same data the schema describes
- [[en/server/index|Server / deploy]] — the operator-facing pages that invoke `obsidian-remote-server`
