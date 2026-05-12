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
// notifications, then emits cli.done when the process exits.
func CliSpawn(vaultRoot string) rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.CliSpawnParams
		if e := decodeParams("cli.spawn", params, &p); e != nil {
			return nil, e
		}
		if p.ID == "" {
			return nil, rpc.ErrInvalidParams("cli.spawn: id is required")
		}
		if e := validateCliCommand(p.Cmd); e != nil {
			return nil, e
		}
		dir, e := resolveCliWorkingDir(vaultRoot, p.Cwd)
		if e != nil {
			return nil, e
		}

		cmd := exec.CommandContext(ctx, p.Cmd, p.Args...)
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

		proc := &cliProcess{cmd: cmd}
		if ok := registerCliProcess(p.ID, proc); !ok {
			_ = killProcess(ctx, proc)
			_ = cmd.Wait()
			return nil, rpc.ErrExists("cli process id: " + p.ID)
		}

		session := server.SessionFromContext(ctx)
		go func() {
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				streamCliOutput(session, p.ID, "stdout", stdoutPipe)
			}()
			go func() {
				defer wg.Done()
				streamCliOutput(session, p.ID, "stderr", stderrPipe)
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
			deleteCliProcess(p.ID)
			_ = session.SendNotification("cli.done", proto.CliDoneParams{
				ID:       p.ID,
				ExitCode: exitCode,
				Error:    doneErr,
			})
		}()

		return proto.CliSpawnResult{OK: true}, nil
	}
}
