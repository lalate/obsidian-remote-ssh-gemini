package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

// UpdateConfig carries the daemon's current configuration so the
// server.update handler can reconstruct the command line for the
// restarted daemon.
type UpdateConfig struct {
	Version    string
	Repo       string // owner/repo
	VaultRoot  string
	SocketPath string
	TokenPath  string
	WsAddr     string
	Verbose    bool
}

// ServerUpdate returns the handler for the `server.update` RPC method.
// It downloads the daemon binary for the current platform from GitHub
// Releases, verifies it against daemon-manifest.json (sha256), writes a
// restart script, signals the daemon to exit, and returns immediately.
//
// The caller (plugin) should call this, wait for the response, then
// expect the WebSocket connection to drop as the daemon restarts.
func ServerUpdate(cfg UpdateConfig) rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.ServerUpdateParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, rpc.ErrInvalidParams("server.update: " + err.Error())
		}

		targetVer := p.Version
		if targetVer == "" {
			targetVer = cfg.Version
		}

		if targetVer == cfg.Version {
			// Same version — nothing to do. Still return success
			// (already up-to-date).
			return proto.ServerUpdateResult{
				Version:    targetVer,
				Restarting: false,
			}, nil
		}

		binaryExt := ""
		if runtime.GOOS == "windows" {
			binaryExt = ".exe"
		}
		binaryName := fmt.Sprintf("obsidian-remote-server-%s-%s%s",
			runtime.GOOS, runtime.GOARCH, binaryExt)
		manifestURL := fmt.Sprintf(
			"https://github.com/%s/releases/download/%s/daemon-manifest.json",
			cfg.Repo, targetVer,
		)
		baseURL := fmt.Sprintf(
			"https://github.com/%s/releases/download/%s",
			cfg.Repo, targetVer,
		)

		// Fetch manifest
		manifestRaw, err := fetchURL(manifestURL, 30)
		if err != nil {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: fetch manifest: %s", err.Error()),
			)
		}

		var manifest map[string]string
		if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: parse manifest: %s", err.Error()),
			)
		}

		expectedSHA, ok := manifest[binaryName]
		if !ok {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: no manifest entry for %s", binaryName),
			)
		}

		// Download binary
		binaryURL := fmt.Sprintf("%s/%s", baseURL, binaryName)
		binaryBytes, err := fetchURL(binaryURL, 120)
		if err != nil {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: download binary: %s", err.Error()),
			)
		}

		// Verify sha256
		gotSHA := fmt.Sprintf("%x", sha256.Sum256(binaryBytes))
		if !strings.EqualFold(gotSHA, expectedSHA) {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: sha256 mismatch for %s", binaryName),
			)
		}

		// Find current binary path
		currentPath, err := os.Executable()
		if err != nil {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: resolve executable: %s", err.Error()),
			)
		}
		currentDir := filepath.Dir(currentPath)

		// Write new binary alongside current one
		newPath := filepath.Join(currentDir, ".obsidian-remote-server.update")
		if err := os.WriteFile(newPath, binaryBytes, 0o700); err != nil {
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: write binary: %s", err.Error()),
			)
		}

		// Build restart command
		restartArgs := []string{
			fmt.Sprintf("--vault-root=%s", cfg.VaultRoot),
			fmt.Sprintf("--socket=%s", cfg.SocketPath),
			fmt.Sprintf("--token-file=%s", cfg.TokenPath),
		}
		if cfg.WsAddr != "" {
			restartArgs = append(restartArgs, fmt.Sprintf("--ws-addr=%s", cfg.WsAddr))
		}
		if cfg.Verbose {
			restartArgs = append(restartArgs, "--verbose")
		}

		// Write restart script
		scriptContent := fmt.Sprintf(`#!/bin/sh
sleep 2
mv "%s" "%s"
chmod +x "%s"
exec nohup "%s" %s < /dev/null 2>&1 &
`,
			newPath, currentPath, currentPath, currentPath,
			strings.Join(restartArgs, " "),
		)
		scriptPath := filepath.Join(currentDir, ".obsidian-remote-server-restart.sh")
		if err := os.WriteFile(scriptPath, []byte(scriptContent), 0o700); err != nil {
			_ = os.Remove(newPath)
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: write script: %s", err.Error()),
			)
		}

		// Launch restart script in background
		cmd := exec.Command("/bin/sh", scriptPath)
		cmd.Stdin = nil
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Start(); err != nil {
			_ = os.Remove(newPath)
			_ = os.Remove(scriptPath)
			return nil, rpc.ErrInternal(
				fmt.Sprintf("server.update: launch restart: %s", err.Error()),
			)
		}

		// Schedule graceful shutdown 500ms after returning — enough
		// time for the JSON-RPC response to be sent back to the client.
		go func() {
			time.Sleep(500 * time.Millisecond)
			// Try SIGTERM first (graceful)
			proc, _ := os.FindProcess(os.Getpid())
			if proc != nil {
				_ = proc.Signal(os.Interrupt)
			}
			// Hard kill after 5s if still alive
			time.Sleep(5 * time.Second)
			os.Exit(0)
		}()

		return proto.ServerUpdateResult{
			Version:    targetVer,
			Restarting: true,
		}, nil
	}
}

// binaryFilename returns the daemon release asset name for the current
// OS/arch, matching the naming convention used by the Makefile's cross
// target and DaemonDownloader.ts.
func binaryFilename() string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("obsidian-remote-server-%s-%s%s", runtime.GOOS, runtime.GOARCH, ext)
}

// fetchURL downloads the contents of url with a timeout. The caller
// chooses timeoutSec based on expected payload size (30s for a small
// manifest, 120s for a multi-MB binary).
func fetchURL(url string, timeoutSec int) ([]byte, error) {
	client := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, resp.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
