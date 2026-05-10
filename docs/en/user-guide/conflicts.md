---
title: Conflict handling
tags: [user-guide]
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

## The "save a copy" backstop

Whichever path you take, the conflicting version is preserved in:

```
<remote vault>/.obsidian-remote/conflicts/<file>.<timestamp>.bak
```

So you can never lose the rejected edit by accident. These backups accumulate; the operations panel includes a **Clear conflict backups older than 30 days** action.

## Three-way merges (advanced)

When both sides have a known **common ancestor** (the version the local shadow last synced), the diff view offers an automatic three-way merge:

```
Common ancestor:  "The cat sat on the mat"
Local edit:       "The cat sat on the rug"
Remote edit:      "The black cat sat on the mat"
Auto-merge:       "The black cat sat on the rug"
```

Non-conflicting line edits are merged automatically; only truly overlapping changes prompt for a per-hunk decision. This works best on plain markdown — heavily metadata-laden frontmatter usually needs a manual review.

## Reducing conflicts

Most conflicts in practice come from:

1. **Two clients open at once** — close other Obsidians before editing.
2. **A sync tool ALSO touching the vault** — pick one sync mechanism. obsidian-remote-ssh does not play well with Syncthing pointed at the same directory.
3. **Cron / scripts writing into the vault** — schedule them to write at idle hours, or rewrite to use the daemon's [[en/api/filesystem|fs.write]] (with proper mtime tracking).

Next: [[en/user-guide/terminal-pane|Terminal pane]].
