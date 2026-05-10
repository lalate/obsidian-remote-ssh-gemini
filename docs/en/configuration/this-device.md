---
title: This device
tags: [configuration, reference]
description: "Per-device settings for obsidian-remote-ssh: Client ID partitioning of remote workspace state, user name display, telemetry opt-in, debug logging toggle."
---

# Configuration reference — This device

Settings under **Settings** → **This device** identify which client you are talking from. Important when multiple devices edit the same remote vault — workspace state, presence, and conflict telemetry are scoped per client.

## Settings

| Field | Type | Default | Description |
|---|---|---|---|
| Client ID | string | empty (= sanitized OS hostname) | Per-device identifier; surfaces in remote `.obsidian/user/<id>/`. Allowed chars: `A-Z a-z 0-9 . - _`; others replaced with `-`. |
| User name | string | empty (= OS username) | Display name; surfaces in notices and (planned) presence info. Cosmetic. |

## Why per-device IDs

The remote vault contains a `.obsidian/user/<client-id>/` subtree per client that tracks workspace layout (open tabs, pane sizes, cursor position). When two devices edit the same vault, each gets its own subtree so they do not stomp on each other's window state.

Changing the Client ID starts a new subtree; the old one is left behind for you to clean up manually.

Next: [[en/configuration/terminal|Terminal]].
