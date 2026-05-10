---
title: Conflict handling
tags: [user-guide]
description: "How obsidian-remote-ssh detects and surfaces edit conflicts. mtime preconditions, daemon-mediated rejection, the conflict modal, what's preserved vs overwritten."
---

# Conflict handling

When the same file is edited locally (in Obsidian's shadow vault) AND remotely (in a terminal, by another client, by a sync tool) at the same time, obsidian-remote-ssh detects the conflict and offers a resolution.

## How conflicts are detected

Every write through the daemon carries an **expected mtime** precondition (see [[en/api/filesystem|fs.write]]). When the daemon's view of the file's current mtime does not match what the client expected, the daemon refuses with `PreconditionFailed (-32020)`.

This catches:

- A note edited on the remote (vim, another Obsidian) while you have it open locally.
- Your other device editing the same vault via its own shadow.
- A cron / sync tool (Syncthing, rsync) touching the file mid-edit.

## What you'll see

A toast appears in the bottom-right:

```
Conflict in note.md — remote was modified after you opened it
[ Keep local ]   [ Keep remote ]   [ View diff ]
```

- **Keep local** — overwrite the remote with your in-Obsidian content.
- **Keep remote** — discard your edits and load the remote version.
- **View diff** — open a side-by-side diff in a temporary buffer; choose per-line which side wins.

> **There is no automatic backup of the rejected side.** "Keep remote" overwrites your in-Obsidian edits with the remote content; "Keep local" overwrites the remote with your in-Obsidian content. If you might want both versions, copy the one you'd lose into a separate file before clicking — there is no `.bak` to recover from.
>
> An automatic conflict-backup mechanism is on the roadmap.

## Reducing conflicts

Most conflicts in practice come from:

1. **Two clients open at once** — close other Obsidians before editing.
2. **A sync tool ALSO touching the vault** — pick one sync mechanism. obsidian-remote-ssh does not play well with Syncthing pointed at the same directory.
3. **Cron / scripts writing into the vault** — schedule them to write at idle hours, or rewrite to use the daemon's [[en/api/filesystem|fs.write]] (with proper mtime tracking).

Next: [[en/user-guide/terminal-pane|Terminal pane]].
