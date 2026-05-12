package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

// CliExec executes a whitelisted command and returns the full stdout/stderr
// payload when the process exits.
func CliExec(vaultRoot string) rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.CliExecParams
		if e := decodeParams("cli.exec", params, &p); e != nil {
			return nil, e
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

		var stdout bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		exitCode := 0
		err := cmd.Run()
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				return nil, rpc.ErrInternal("cli.exec: " + err.Error())
			}
		}

		return proto.CliExecResult{
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			ExitCode: exitCode,
		}, nil
	}
}
