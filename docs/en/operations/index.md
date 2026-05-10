---
title: Operations
tags: [operations]
---

# Operations

What to do when the plugin is running and you need to *operate* it: read its logs, diagnose a problem, tune for speed, upgrade, or uninstall. Symptom → fix.

## Pages

| Page | When to read |
|---|---|
| [[en/operations/troubleshooting\|Troubleshooting]] | Something doesn't work. The symptom-to-cause-to-fix map. **Start here for any "it's broken" question.** |
| [[en/operations/performance-tuning\|Performance tuning]] | "It works but feels slow." Network / disk / inotify / daemon-cache playbook. |
| [[en/operations/reconnect\|Reconnect behaviour]] | What the plugin does when the SSH link drops + how to tune the retries |
| [[en/operations/daemon-panel\|Daemon panel]] | The Settings → Daemon UI: status badge, log viewer, restart button |
| [[en/operations/logs\|Logs]] | Where every log lives (plugin `console.log`, daemon `server.log`), rotation, sensitive content |
| [[en/operations/upgrading\|Upgrading]] | How a new plugin version arrives + when the daemon gets re-deployed |
| [[en/operations/uninstalling\|Uninstalling]] | Clean removal — both local plugin state and remote daemon files |

## Reading order

There isn't one — operations docs are reached by symptom, not sequentially. The closest to "read me first" is [[en/operations/troubleshooting|Troubleshooting]] because it's the dispatcher to the others.

## See also

- [[en/api/errors|Error codes]] — what error names mean when they show up in logs
- [[en/security/model|Security model]] — what the daemon is allowed to touch
- [[en/contributing/release-flow|Release flow]] — how new versions are produced (helps when you want to know what's in the upgrade you just got)
