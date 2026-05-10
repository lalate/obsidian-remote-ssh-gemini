---
title: Terminal pane
tags: [user-guide]
---

# Terminal pane

The plugin includes an integrated terminal that runs your remote login shell over the existing SSH session. Useful for quick `git pull`, dotfile tweaks, or tailing logs without leaving Obsidian.

## Open it

Either:

- **Command palette** → "Remote SSH: Open terminal"
- **Ribbon menu** → "Terminal"

A terminal opens as a regular Obsidian pane; you can split it, drag it to a sidebar, etc.

## What you get

- Your remote user's default login shell (`$SHELL`, typically `bash` or `zsh`).
- Full TTY: aliases, colours, `fzf`, `htop`, `vim`, `tmux` all work.
- Resizes when you resize the pane.
- Persists across pane re-opens within a session — closing the pane retains scrollback until you disconnect.

## Settings

**Settings** → **Terminal**:

| Setting | Default | Notes |
|---|---|---|
| Shell command | (use remote `$SHELL`) | Override with e.g. `/usr/bin/zsh -l` if you want a specific shell + login flag |
| Font size (px) | 12 | 6–32 |
| Scrollback (lines) | 1000 | 100–100,000; in-memory only, not persisted across re-opens |

## Caveats

- Not an interactive `claude` / `vim` session in the strictest sense — it's xterm.js, which handles 99% of TUI apps but trips on a few exotic ones (`mc`'s mouse, full-screen `less` with mouse wheel). For rare cases, fall back to a real terminal app.
- Shell history is the remote shell's history (`.bash_history`, `.zsh_history`). Survives reconnects.
- Environment: the terminal inherits the remote user's login environment, NOT the plugin's daemon environment. They are independent processes.

## Why not just use a separate terminal app?

Two reasons:

1. **One auth chain**: the terminal piggybacks on the SSH session the plugin already has open, so no extra auth prompt or jump-host re-traversal.
2. **Closer to your editor**: dotfile tweaks, `git status`, syncing scripts — the actions that pair with vault editing benefit from the colocation.

For long-running shells (tmux session, monitoring), a standalone terminal is still better. The plugin's terminal is for quick interactions adjacent to your editing flow.

Next: [[en/configuration/profiles|Configuration reference — Profiles]].
