package handlers

import (
	"context"
	"encoding/json"
	"os/exec"
	"sync"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

// CliSpawn starts a whitelisted process and streams output via cli.output
// and cli.output.batch notifications, then emits cli.done when the process exits.
func CliSpawn(vaultRoot string) rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.CliSpawnParams
		if e := decodeParams("cli.spawn", params, &p); e != nil {
			return nil, e
		}
		if p.ID == "" {
			return nil, rpc.ErrInvalidParams("cli.spawn: id is required")
		}

		session := server.SessionFromContext(ctx)

		// Check if we are resuming an existing process.
		if p.ResumeFrom != nil {
			if proc, ok := getCliProcess(p.ID); ok {
				// Re-attach and resume.
				proc.streamer.Resume(session, *p.ResumeFrom)
				return proto.CliSpawnResult{OK: true}, nil
			}
			return nil, rpc.ErrInvalidParams("cli.spawn: resume requested for unknown id: " + p.ID)
		}

		if e := validateCliCommand(p.Cmd); e != nil {
			return nil, e
		}
		dir, e := validateWorkingDir(vaultRoot, p.Cwd)
		if e != nil {
			return nil, e
		}

		// Use Background context so the process can outlive the RPC request if needed.
		// Lifecycle is managed by cmd.Wait() in the goroutine and cli.kill.
		cmd := exec.Command(p.Cmd, p.Args...)
		cmd.Dir = dir
		if p.Env != nil {
			cmd.Env = buildCliEnv(p.Env)
		}

		stdoutPipe, err := cmd.StdoutPipe()
		if err != nil {
			return nil, rpc.ErrInternal("cli.spawn: stdout pipe: " + err.Error())
		}
		stderrPipe, err := cmd.StderrPipe()
		if err != nil {
			return nil, rpc.ErrInternal("cli.spawn: stderr pipe: " + err.Error())
		}

		if err := cmd.Start(); err != nil {
			return nil, rpc.ErrInternal("cli.spawn: start: " + err.Error())
		}

		streamer, err := newCliStreamer(session, p.ID, p.Persist)
		if err != nil {
			_ = cmd.Process.Kill()
			return nil, rpc.ErrInternal("cli.spawn: streamer: " + err.Error())
		}
		streamer.Start()

		proc := &cliProcess{cmd: cmd, streamer: streamer}
		if ok := registerCliProcess(p.ID, proc); !ok {
			_ = killProcess(ctx, proc)
			_ = cmd.Wait()
			streamer.Close()
			return nil, rpc.ErrExists("cli process id: " + p.ID)
		}

		go func() {
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				streamer.Stream("stdout", stdoutPipe)
			}()
			go func() {
				defer wg.Done()
				streamer.Stream("stderr", stderrPipe)
			}()

			waitErr := cmd.Wait()
			exitCode := 0
			doneErr := ""
			if waitErr != nil {
				if exitErr, ok := waitErr.(*exec.ExitError); ok {
					exitCode = exitErr.ExitCode()
				} else {
					doneErr = waitErr.Error()
				}
			}

			wg.Wait()
			streamer.Close()
			deleteCliProcess(p.ID)

			// The session might have changed since start, so refresh it from the streamer.
			streamer.mu.Lock()
			finalSession := streamer.session
			streamer.mu.Unlock()

			if finalSession != nil {
				_ = finalSession.SendNotification("cli.done", proto.CliDoneParams{
					ID:       p.ID,
					ExitCode: exitCode,
					Error:    doneErr,
				})
			}
		}()

		return proto.CliSpawnResult{OK: true}, nil
	}
}
