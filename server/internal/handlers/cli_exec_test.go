package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

func TestCliExec_WhitelistRejection(t *testing.T) {
	h := CliExec(t.TempDir())
	raw, _ := json.Marshal(proto.CliExecParams{Cmd: "not-allowed", Args: []string{"x"}})
	_, rerr := h(context.Background(), raw)
	if rerr == nil || rerr.Code != proto.ErrorPermissionDenied {
		t.Fatalf("want PermissionDenied, got %+v", rerr)
	}
}

func TestCliExec_Success(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	h := CliExec(t.TempDir())
	raw, _ := json.Marshal(proto.CliExecParams{
		Cmd: os.Args[0],
		Args: []string{
			"-test.run=TestCliExecHelperProcess",
			"--",
			"success",
		},
		Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1"},
	})

	result, rerr := h(context.Background(), raw)
	if rerr != nil {
		t.Fatalf("unexpected rpc error: %+v", rerr)
	}
	got := result.(proto.CliExecResult)
	if got.ExitCode != 0 {
		t.Fatalf("ExitCode = %d, want 0", got.ExitCode)
	}
	if !strings.Contains(got.Stdout, "helper-ok") {
		t.Fatalf("stdout = %q, want helper output", got.Stdout)
	}
	if !strings.Contains(got.Stderr, "helper-err") {
		t.Fatalf("stderr = %q, want helper stderr", got.Stderr)
	}
}

func TestCliExec_NonZeroExitCode(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	h := CliExec(t.TempDir())
	raw, _ := json.Marshal(proto.CliExecParams{
		Cmd: os.Args[0],
		Args: []string{
			"-test.run=TestCliExecHelperProcess",
			"--",
			"exit-42",
		},
		Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1"},
	})

	result, rerr := h(context.Background(), raw)
	if rerr != nil {
		t.Fatalf("unexpected rpc error: %+v", rerr)
	}
	got := result.(proto.CliExecResult)
	if got.ExitCode != 42 {
		t.Fatalf("ExitCode = %d, want 42", got.ExitCode)
	}
}

func TestCliExecHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	args := os.Args
	idx := -1
	for i, a := range args {
		if a == "--" {
			idx = i
			break
		}
	}
	if idx == -1 || idx+1 >= len(args) {
		fmt.Fprintln(os.Stderr, "missing helper mode")
		os.Exit(2)
	}

	switch args[idx+1] {
	case "success":
		fmt.Fprintln(os.Stdout, "helper-ok")
		fmt.Fprintln(os.Stderr, "helper-err")
		os.Exit(0)
	case "exit-42":
		fmt.Fprintln(os.Stderr, "helper-fail")
		os.Exit(42)
	default:
		os.Exit(3)
	}
}
