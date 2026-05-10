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
  event: 'created' | 'modified' | 'deleted';
  mtime?: number;          // present on created / modified
}
```

> The proto reserves a `renamed` event tag for future use, but the current daemon emits only `created` / `modified` / `deleted`. Renames surface as a `deleted` + `created` pair on the affected paths; clients that need rename detection match those pairs heuristically.

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

## Coalescing

The current daemon does NOT debounce or coalesce events server-side — every inotify event maps directly to one `fs.changed` notification. Clients that want UI-friendly throttling should debounce on their own side (the plugin does this for the "remote modified" toast).

A burst of writes on the same file therefore produces one notification per write. Editors that do atomic-saves (vim, emacs auto-save) will produce a `deleted` + `created` pair the client must collapse if it wants to render the operation as a single "modified".

## Recursive caveats

Recursive watchers on huge trees (50k+ files) can take 100–500 ms to set up the inotify subscriptions. The daemon performs this in the `fs.watch` call itself; callers should expect that latency.

inotify watch limits (`/proc/sys/fs/inotify/max_user_watches`) bound the maximum subscription depth on Linux. The default is 8192 on most distros — large vaults may need:

```bash
echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches
```

The daemon logs a warning if it hits the limit.

Next: [[en/api/errors|Error codes]].
