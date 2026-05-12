package handlers

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

var cliWhitelist = map[string]bool{
	"gemini": true,
	"git":    true,
}

func isWhitelisted(cmd string) bool {
	return cliWhitelist[cmd]
}

func validateCliCommand(cmd string) *rpc.Error {
	if cmd == "" {
		return rpc.ErrInvalidParams("cli: cmd is required")
	}
	if !isWhitelisted(cmd) {
		return rpc.ErrPermissionDenied(fmt.Sprintf("command not whitelisted: %s", cmd))
	}
	return nil
}

func resolveCliWorkingDir(vaultRoot, cwd string) (string, *rpc.Error) {
	if cwd == "" {
		return vaultRoot, nil
	}
	return resolveOrErr(vaultRoot, cwd)
}

func buildCliEnv(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}

type cliProcess struct {
	cmd *exec.Cmd
}

var cliProcessStore = struct {
	mu sync.Mutex
	m  map[string]*cliProcess
}{m: map[string]*cliProcess{}}

func registerCliProcess(id string, p *cliProcess) bool {
	cliProcessStore.mu.Lock()
	defer cliProcessStore.mu.Unlock()
	if _, exists := cliProcessStore.m[id]; exists {
		return false
	}
	cliProcessStore.m[id] = p
	return true
}

func getCliProcess(id string) (*cliProcess, bool) {
	cliProcessStore.mu.Lock()
	defer cliProcessStore.mu.Unlock()
	p, ok := cliProcessStore.m[id]
	return p, ok
}

func deleteCliProcess(id string) {
	cliProcessStore.mu.Lock()
	defer cliProcessStore.mu.Unlock()
	delete(cliProcessStore.m, id)
}

func streamCliOutput(session *server.Session, id, stream string, r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			_ = session.SendNotification("cli.output", proto.CliOutputParams{
				ID:     id,
				Stream: stream,
				Data:   string(buf[:n]),
			})
		}
		if err != nil {
			return
		}
	}
}

func killProcess(_ context.Context, p *cliProcess) error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	if err := p.cmd.Process.Kill(); err != nil {
		if err == os.ErrProcessDone {
			return nil
		}
		return err
	}
	return nil
}
