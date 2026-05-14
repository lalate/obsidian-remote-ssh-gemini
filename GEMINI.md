# Project Mandates: Gemini CLI Integration

## Architecture & Security

### 1. Strict Working Directory Validation
To prevent symlink-based escapes from the vault root, the daemon must validate any `cwd` parameter using real-path resolution.

- **Requirement**: Use `filepath.EvalSymlinks` on the joined path.
- **Check**: Ensure the resolved absolute path starts with the absolute vault root.
- **Error**: Return `ErrorPermissionDenied` (or `ErrorPathOutsideVault`) if the check fails.

### 2. Session Persistence via JSONL Logging
To support re-syncing and robust mobile connectivity, `cli.spawn` output should be persisted when `persist: true` is set.

- **Mechanism**: Redirect process stdout/stderr to a `.jsonl` file in a temporary directory (e.g., `os.TempDir()`).
- **Schema**: Each line is a JSON-serialized `CliOutputParams` object.
- **Resumption**: When a client reconnects and provides `resumeFrom` (sequence number), the daemon must read the log file from that offset and burst-send missing notifications.
- **Cleanup**: Log files must be pruned after the process terminates and a grace period has passed, or when the session ends.

### 3. Output Throttling
To minimize network overhead and mobile battery drain, high-frequency CLI output must be throttled.

- **Requirement**: Implement a buffering layer that bundles `cli.output` chunks into a `cli.output.batch` notification.
- **Interval**: 100ms default bundling window.
- **Burst limit**: Send immediately if the buffer exceeds 50 chunks.

## Protocol Invariants

- **Synchronicity**: `plugin/src/proto/types.ts` and `server/internal/proto/types.go` must remain exact mirrors.
- **Versioning**: Any change to these persisted log formats or batch notification types requires a protocol version check.
