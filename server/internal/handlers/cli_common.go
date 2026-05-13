package handlers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/vaultfs"
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

func validateWorkingDir(vaultRoot, requestedCwd string) (string, *rpc.Error) {
	// Resolve the root once so both symlink and boundary checks use the
	// same canonical base path.
	resolvedRoot, err := filepath.EvalSymlinks(vaultRoot)
	if err != nil {
		return "", rpc.ErrInternal("failed to resolve vault root symlinks: " + err.Error())
	}

	var targetDir string
	if requestedCwd == "" {
		targetDir = resolvedRoot
	} else {
		lexical, err := vaultfs.Resolve(resolvedRoot, requestedCwd)
		if err != nil {
			return "", rpc.ErrPathOutsideVault(requestedCwd)
		}
		targetDir = lexical
	}

	// Resolve symlinks to prevent escapes.
	resolvedPath, err := filepath.EvalSymlinks(targetDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", rpc.ErrFileNotFound(requestedCwd)
		}
		return "", rpc.ErrInternal("failed to resolve symlinks: " + err.Error())
	}

	// Use filepath.Rel instead of naive prefix checks so sibling paths like
	// /vault-escape are not treated as inside /vault.
	rel, err := filepath.Rel(resolvedRoot, resolvedPath)
	if err != nil {
		return "", rpc.ErrInternal("failed to compare paths: " + err.Error())
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", rpc.ErrPermissionDenied("path outside vault root: " + requestedCwd)
	}

	return resolvedPath, nil
}

func buildCliEnv(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}

type cliProcess struct {
	cmd      *exec.Cmd
	streamer *cliStreamer
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
