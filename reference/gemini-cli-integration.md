# Plan: Gemini CLI Integration for obsidian-remote-ssh

## Objective
Enable Gemini CLI execution on the remote server via JSON-RPC. This supports both synchronous (`cli.exec`) and asynchronous streaming (`cli.spawn`) modes, tailored for Obsidian mobile users.

## Context & Architecture
- **Transport**: JSON-RPC over framed unix-socket stream (Length-prefix framing).
- **Session**: Per-connection `Session` object handles authentication and notifications.
- **Whitelist**: Security policy to restrict execution to `gemini` and `git` binaries found in `$PATH`.

---

## Phase 1: Protocol Definitions

### 1.1 Update `next/proto/types.ts`
Add the following methods and types to the canonical protocol definition.

```typescript
// Add to MethodName union
| 'cli.exec'
| 'cli.spawn'
| 'cli.kill';

// New Interfaces
export interface CliExecParams {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CliExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliSpawnParams {
  id: string; // Client-side correlation ID for the process
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CliSpawnResult {
  ok: boolean;
}

// Notifications (Server -> Client)
export interface CliOutputParams {
  id: string;
  stream: 'stdout' | 'stderr';
  data: string; // Base64 or plain string? Protocol uses plain string for text.
}

export interface CliDoneParams {
  id: string;
  exitCode: number;
  error?: string;
}
```

### 1.2 Update `server/internal/proto/types.go`
Mirror the TypeScript changes in Go.

```go
type CliExecParams struct {
	Cmd  string            `json:"cmd"`
	Args []string          `json:"args"`
	Cwd  string            `json:"cwd,omitempty"`
	Env  map[string]string `json:"env,omitempty"`
}

type CliExecResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

type CliSpawnParams struct {
	ID   string            `json:"id"`
	Cmd  string            `json:"cmd"`
	Args []string          `json:"args"`
	Cwd  string            `json:"cwd,omitempty"`
	Env  map[string]string `json:"env,omitempty"`
}

// Result is just { "ok": true } -> use a generic map or empty struct if needed
```

---

## Phase 2: Server Implementation

### 2.1 Whitelist Logic (`server/internal/handlers/cli_common.go`)
Create a shared helper to validate commands.

```go
var cliWhitelist = map[string]bool{
	"gemini": true,
	"git":    true,
}

func isWhitelisted(cmd string) bool {
	return cliWhitelist[cmd]
}
```

### 2.2 Synchronous Exec (`server/internal/handlers/cli_exec.go`)
Implement `cli.exec`.

```go
func CliExec(vaultRoot string) rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.CliExecParams
		if err := decodeParams("cli.exec", params, &p); err != nil {
			return nil, err
		}

		if !isWhitelisted(p.Cmd) {
			return nil, rpc.ErrPermissionDenied(fmt.Sprintf("command %q not whitelisted", p.Cmd))
		}

		cmd := exec.CommandContext(ctx, p.Cmd, p.Args...)
		cmd.Dir = p.Cwd
		if cmd.Dir == "" {
			cmd.Dir = vaultRoot
		}
		// Add env mapping if provided

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		err := cmd.Run()
		exitCode := 0
		if err != nil {
			if exitError, ok := err.(*exec.ExitError); ok {
				exitCode = exitError.ExitCode()
			} else {
				return nil, rpc.ErrInternal(err.Error())
			}
		}

		return proto.CliExecResult{
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			ExitCode: exitCode,
		}, nil
	}
}
```

### 2.3 Asynchronous Spawn (`server/internal/handlers/cli_spawn.go`)
Implement `cli.spawn` with streaming notifications.

- Use `cmd.StdoutPipe()` and `cmd.StderrPipe()`.
- Use `SessionFromContext(ctx)` to get the `Session` for sending notifications.
- In a goroutine:
    1. Read from pipes.
    2. Call `session.SendNotification("cli.output", proto.CliOutputParams{...})`.
    3. On process exit, call `session.SendNotification("cli.done", proto.CliDoneParams{...})`.

---

## Phase 3: Registration

### 3.1 Update `server/cmd/obsidian-remote-server/main.go`
Register the handlers in `run()`.

```go
disp.Handle("cli.exec", handlers.RequireAuth(handlers.CliExec(absRoot)))
disp.Handle("cli.spawn", handlers.RequireAuth(handlers.CliSpawn(absRoot)))
```

---

## Verification

### 1. Manual Testing via RPC
Send a raw JSON-RPC request to the daemon:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "cli.exec",
  "params": {
    "cmd": "gemini",
    "args": ["--version"]
  }
}
```

### 2. Unit Tests
Ensure `server/internal/handlers/cli_exec_test.go` covers:
- Whitelist rejection.
- Success execution.
- Non-zero exit code handling.
