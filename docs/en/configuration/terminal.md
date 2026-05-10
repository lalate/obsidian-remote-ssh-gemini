---
title: Terminal
tags: [configuration, reference]
---

# Configuration reference — Terminal

Settings for the integrated terminal pane. See [[en/user-guide/terminal-pane|Terminal pane]] for usage.

## Settings

| Field | Type | Default | Range | Description |
|---|---|---|---|---|
| Shell command | string | (use remote `$SHELL`) | — | Override the remote login shell. Example: `/usr/bin/zsh -l`. |
| Font size (px) | number | `12` | 6–32 | xterm.js font size |
| Scrollback (lines) | number | `1000` | 100–100000 | In-memory buffer; not persisted across re-opens. |

## Notes

- Setting changes apply on next terminal open — existing terminals are not retro-resized.
- The shell inherits the remote user's login environment. If `$SHELL` resolves to something unusable, override **Shell command** with `--noprofile --norc` flags to recover.
- Scrollback is in-memory only. For persistent history, use a remote `tmux` session.

Next: [[en/configuration/advanced|Advanced]].
