---
title: Watch & notifications
tags: [api, reference]
---

# Watch & notifications

The daemon pushes file change events to subscribed clients via `fs.changed` notifications. This is what powers the plugin's "remote was modified" toast and live-update behaviour.

## `fs.watch`

Subscribe to changes on a path.

```typescript
params: { path: string; recursive?: boolean }
result: { subscriptionId: string }
```

`recursive: true` watches all descendants. The returned `subscriptionId` is opaque (don't parse it) — pass it to `fs.unwatch` to release.

Multiple watchers on overlapping paths are deduplicated server-side; the OS-level inotify subscription is shared.

## `fs.unwatch`

Cancel a subscription.

```typescript
params: { subscriptionId: string }
result: {}
```

Idempotent — unwatching an unknown ID returns `{}` without error.

## `fs.changed` (server → client notification)

Server-pushed; no response. Sent when a watched path's tree changes.

```typescript
params: {
  subscriptionId: string;
  path: string;            // vault-relative path of the affected entry
  event: 'created' | 'modified' | 'deleted' | 'renamed';
  mtime?: number;          // present on created / modified / renamed
  newPath?: string;        // present only on event === 'renamed'
}
```

JSON-RPC notifications have NO `id` field, per spec:

```json
{
  "jsonrpc": "2.0",
  "method": "fs.changed",
  "params": {
    "subscriptionId": "sub_abc123",
    "path": "notes/today.md",
    "event": "modified",
    "mtime": 1715333412000
  }
}
```

## Debouncing & coalescing

The daemon coalesces events within a short window (~150–300 ms) before notifying:

- A burst of `modified` events on the same path collapses to one.
- A `created` immediately followed by `modified` collapses to `created` (with the final mtime).
- A `created` then `deleted` within the window cancels both.
- A `deleted` then `created` (e.g., `vim`'s atomic save) collapses to `modified`.

This makes the notification stream usable for UI updates without flooding the wire.

## Recursive caveats

Recursive watchers on huge trees (50k+ files) can take 100–500 ms to set up the inotify subscriptions. The daemon performs this in the `fs.watch` call itself; callers should expect that latency.

inotify watch limits (`/proc/sys/fs/inotify/max_user_watches`) bound the maximum subscription depth on Linux. The default is 8192 on most distros — large vaults may need:

```bash
echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches
```

The daemon logs a warning if it hits the limit.

Next: [[en/api/errors|Error codes]].
