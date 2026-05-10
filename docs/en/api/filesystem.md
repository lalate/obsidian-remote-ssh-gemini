---
title: Filesystem operations
tags: [api, reference]
---

# Filesystem operations

All `fs.*` methods are client→server, JSON-RPC over the daemon socket. All paths are vault-relative, forward-slash, no `..` (see [[en/api/overview|path conventions]]).

## Read

### `fs.stat`
Metadata for one path. Returns `null` if the path does not exist (NOT an error).

```typescript
params: { path: string }
result: Stat | null

interface Stat {
  type: 'file' | 'folder';
  mtime: number;             // unix milliseconds
  size: number;              // bytes (0 for folders)
  mode: number;              // POSIX mode bits, informational
}
```

### `fs.exists`
Fast existence check.

```typescript
params: { path: string }
result: { exists: boolean }
```

### `fs.list`
List directory contents (non-recursive). Fails if path is not a directory.

```typescript
params: { path: string }
result: { entries: Entry[] }

interface Entry {
  name: string;              // basename only
  type: 'file' | 'folder' | 'symlink';
  mtime: number;
  size: number;
}
```

### `fs.walk`
Recursive tree walk with optional cap.

```typescript
params: {
  path: string;
  recursive?: boolean;       // default true
  maxEntries?: number;       // budget; truncates beyond
}
result: {
  entries: WalkEntry[];      // path is vault-relative
  truncated: boolean;
}

interface WalkEntry {
  path: string;              // vault-relative
  type: 'file' | 'folder' | 'symlink';
  mtime: number;
  size: number;
}
```

### `fs.readText`
UTF-8 text read.

```typescript
params: { path: string; encoding?: 'utf8' }
result: { content: string; mtime: number; size: number; encoding: 'utf8' }
```

### `fs.readBinary`
Full binary read, base64-encoded.

```typescript
params: { path: string }
result: { contentBase64: string; mtime: number; size: number }
```

### `fs.readBinaryRange`
Partial binary read. Clamps silently past EOF. `expectedMtime` precondition causes the request to fail with `PreconditionFailed` if the file changed mid-read.

```typescript
params: {
  path: string;
  offset: number;
  length: number;
  expectedMtime?: number;
}
result: { contentBase64: string; mtime: number; size: number }
```

### `fs.thumbnail`
Server-side image resize. JPEG q=80 or PNG (preserves alpha).

```typescript
params: { path: string; maxDim: number }
result: {
  contentBase64: string;
  mtime: number;
  sourceSize: number;
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}
```

## Write

### `fs.write` / `fs.writeBinary`
Atomic write (tmp file + rename). Fails with `PreconditionFailed (-32020)` if `expectedMtime` does not match current.

```typescript
params: {
  path: string;
  content: string;          // (or contentBase64 for binary)
  expectedMtime?: number;
}
result: { mtime: number }
```

`expectedMtime` is the conflict-detection mechanism — see [[en/user-guide/conflicts|Conflict handling]].

### `fs.append` / `fs.appendBinary`
Append-only write.

```typescript
params: { path: string; content: string }   // or contentBase64
result: { mtime: number }
```

### `fs.mkdir`
Create directory. `recursive: true` creates parent dirs (mkdir -p).

```typescript
params: { path: string; recursive?: boolean }
result: {}
```

### `fs.remove` / `fs.rmdir`
Delete. `fs.remove` for files; `fs.rmdir` for directories. `rmdir` with `recursive: true` deletes contents.

```typescript
params: { path: string; recursive?: boolean }   // recursive only on rmdir
result: {}
```

### `fs.rename`
Atomic rename. Creates destination parent dirs if needed.

```typescript
params: { oldPath: string; newPath: string }
result: { mtime: number }
```

### `fs.copy`
Copy file contents (no server-side reflink yet; reads + writes).

```typescript
params: { srcPath: string; destPath: string }
result: { mtime: number }
```

### `fs.trashLocal`
Move path under `<vaultRoot>/.trash/…`. Creates intermediate dirs.

```typescript
params: { path: string }
result: {}
```

A future `fs.trashSystem` is on the roadmap to route to the OS trash via `gio trash` / `osascript`; until then, only the in-vault `.trash/` form exists.

Next: [[en/api/watch|Watch & notifications]].
