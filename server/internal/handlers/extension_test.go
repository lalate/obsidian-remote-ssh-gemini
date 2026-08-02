package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/extensions"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

func TestValidateAndBuildArgs_RejectsLeadingDash(t *testing.T) {
	cap := proto.ExtensionCapability{
		Tool: "tool",
		Args: []proto.ExtensionArgRule{{
			Name:      "prompt",
			Required:  true,
			MaxLength: 1024,
		}},
	}
	_, err := validateAndBuildArgs(cap, map[string]string{"prompt": "--config /tmp/evil.yaml"})
	if err == nil {
		t.Fatalf("expected error for leading dash")
	}
	if !strings.Contains(err.Error(), "must not start") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateAndBuildArgs_AllowsLeadingDashWhenConfigured(t *testing.T) {
	cap := proto.ExtensionCapability{
		Tool: "tool",
		Args: []proto.ExtensionArgRule{{
			Name:       "flag",
			Required:   true,
			AllowFlags: true,
		}},
	}
	args, err := validateAndBuildArgs(cap, map[string]string{"flag": "--help"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(args) != 1 || args[0] != "--help" {
		t.Fatalf("args = %v, want [--help]", args)
	}
}

func TestExtensionKill_NotFound_ReturnsKilledFalse(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	h := r.Kill()

	ctx := server.WithSession(context.Background(), server.NewSession())
	res, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-missing"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionKillResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if out.Killed {
		t.Fatalf("Killed = true, want false")
	}
}

func TestExtensionKill_ExistingInvocationCanBeKilled(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	owner := server.NewSession()
	called := false
	r.registerInvocation("inv-2", owner, "batch", func() error {
		called = true
		return nil
	})

	h := r.Kill()
	ownerCtx := server.WithSession(context.Background(), owner)
	res, rpcErr := h(ownerCtx, json.RawMessage(`{"invocationId":"inv-2"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionKillResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if !out.Killed {
		t.Fatalf("Killed = false, want true")
	}
	if !called {
		t.Fatalf("stop should be called for owner session")
	}
}

func TestExtensionKill_CompatAlias(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	r.registerInvocation("inv-3", server.NewSession(), "batch", func() error {
		return nil
	})

	h := r.KillCompat()
	ctx := server.WithSession(context.Background(), server.NewSession())
	res, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-3"}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionKillResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if !out.Killed {
		t.Fatalf("Killed = false, want true")
	}
}

func TestExtensionInvoke_ResumeFromCompletedInvocation(t *testing.T) {
	tmp := t.TempDir()
	store, err := extensions.NewLogStore(filepath.Join(tmp, "state"))
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}

	inv := "inv-completed"
	ok, err := store.AppendBatch(inv, []proto.CliOutputBatchItem{
		{Stream: "stdout", Data: "output\n", Seq: 1},
	})
	if err != nil || !ok {
		t.Fatalf("AppendBatch: ok=%v err=%v", ok, err)
	}
	if err := store.AppendDone(inv, 0, ""); err != nil {
		t.Fatalf("AppendDone: %v", err)
	}

	r := NewExtensionRunner(nil, store, "")

	receiver := server.NewSession()
	notified := false
	doneNotified := false
	receiver.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		switch method {
		case "cli.output.batch":
			notified = true
		case "cli.done":
			doneNotified = true
		}
		return nil
	})

	h := r.Invoke()
	ctx := server.WithSession(context.Background(), receiver)
	res, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-completed","resumeFrom":0}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionInvokeResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if out.InvocationID != "inv-completed" || !out.Accepted {
		t.Fatalf("unexpected result: %+v", out)
	}
	if !notified {
		t.Fatalf("expected replay notification")
	}
	if !doneNotified {
		t.Fatalf("expected cli.done notification for completed invocation")
	}
}

func TestExtensionInvoke_ResumeFromMissingInvocation(t *testing.T) {
	tmp := t.TempDir()
	store, err := extensions.NewLogStore(filepath.Join(tmp, "state"))
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}

	r := NewExtensionRunner(nil, store, "")

	h := r.Invoke()
	ctx := server.WithSession(context.Background(), server.NewSession())
	_, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-missing","resumeFrom":0}`))
	if rpcErr == nil {
		t.Fatalf("expected rpc error for missing invocation")
	}
}

func TestExtensionInvoke_ResumeFromRunningInvocation(t *testing.T) {
	tmp := t.TempDir()
	store, err := extensions.NewLogStore(filepath.Join(tmp, "state"))
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}

	inv := "inv-running"
	ok, err := store.AppendBatch(inv, []proto.CliOutputBatchItem{
		{Stream: "stdout", Data: "line1\n", Seq: 1},
	})
	if err != nil || !ok {
		t.Fatalf("AppendBatch: ok=%v err=%v", ok, err)
	}

	r := NewExtensionRunner(nil, store, "")
	owner := server.NewSession()
	r.registerInvocation(inv, owner, "batch", func() error { return nil })

	receiver := server.NewSession()
	notified := false
	receiver.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		if method == "cli.output.batch" {
			notified = true
		}
		return nil
	})

	h := r.Invoke()
	ctx := server.WithSession(context.Background(), receiver)
	res, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-running","resumeFrom":0}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionInvokeResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if out.InvocationID != "inv-running" || !out.Accepted {
		t.Fatalf("unexpected result: %+v", out)
	}
	if !notified {
		t.Fatalf("expected replay notification")
	}

	// Verify session was rebound
	s := r.currentInvocationSession(inv)
	if s != receiver {
		t.Fatalf("session should be rebound to receiver")
	}
}

func TestExtensionInvoke_ResumeFromWithDoneAtEnd(t *testing.T) {
	tmp := t.TempDir()
	store, err := extensions.NewLogStore(filepath.Join(tmp, "state"))
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}

	inv := "inv-done-at-end"
	ok, err := store.AppendBatch(inv, []proto.CliOutputBatchItem{
		{Stream: "stdout", Data: "line1\n", Seq: 1},
		{Stream: "stdout", Data: "line2\n", Seq: 2},
	})
	if err != nil || !ok {
		t.Fatalf("AppendBatch: ok=%v err=%v", ok, err)
	}
	if err := store.AppendDone(inv, 0, ""); err != nil {
		t.Fatalf("AppendDone: %v", err)
	}

	r := NewExtensionRunner(nil, store, "")

	receiver := server.NewSession()
	itemsReceived := 0
	doneReceived := false
	receiver.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		switch method {
		case "cli.output.batch":
			itemsReceived++
		case "cli.done":
			doneReceived = true
		}
		return nil
	})

	h := r.Invoke()
	ctx := server.WithSession(context.Background(), receiver)
	_, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-done-at-end","resumeFrom":0}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	if itemsReceived != 1 {
		t.Fatalf("expected 1 batch notification, got %d", itemsReceived)
	}
	if !doneReceived {
		t.Fatalf("expected cli.done notification")
	}
}

func TestStreamProcess_ReapsOrphanedInvocation(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	r.orphanTimeout = 50 * time.Millisecond

	// exec (not a child sleep) so that killing the process closes the
	// pipes immediately — a leftover child would keep the write end open
	// and the scanStream goroutine would never see EOF.
	cmd := exec.Command("sh", "-c", "echo hello; exec sleep 30")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatalf("StderrPipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer cmd.Process.Kill()

	// Client whose notifier always fails: simulate a dropped connection.
	sess := server.NewSession()
	sess.SetNotifier(func(_ string, _ interface{}, _ *proto.Meta) error {
		return errors.New("client gone")
	})
	inv := "inv-orphan"
	r.registerInvocation(inv, sess, "batch", func() error { return cmd.Process.Kill() })

	released := make(chan struct{})
	go r.streamProcess(inv, cmd, stdout, stderr, false, "batch", func() { close(released) })

	select {
	case <-released:
	case <-time.After(5 * time.Second):
		t.Fatalf("orphaned invocation was not reaped within 5s")
	}

	if _, ok := r.lookupInvocation(inv); ok {
		t.Fatalf("invocation %q should be unregistered after reap", inv)
	}
}

func TestStreamProcess_KeepsProcessAliveWithLiveSession(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	r.orphanTimeout = 50 * time.Millisecond

	cmd := exec.Command("sh", "-c", "echo hello; exec sleep 30")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatalf("StderrPipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer cmd.Process.Kill()

	sess := server.NewSession()
	sess.SetNotifier(func(_ string, _ interface{}, _ *proto.Meta) error { return nil })
	inv := "inv-live"
	r.registerInvocation(inv, sess, "batch", func() error { return cmd.Process.Kill() })

	released := make(chan struct{})
	go r.streamProcess(inv, cmd, stdout, stderr, false, "batch", func() { close(released) })

	// Well past orphanTimeout (50ms): a live session must not be reaped.
	time.Sleep(300 * time.Millisecond)
	select {
	case <-released:
		t.Fatalf("live invocation was reaped")
	default:
	}

	// Cleanup: kill and expect the natural teardown path.
	_ = cmd.Process.Kill()
	select {
	case <-released:
	case <-time.After(5 * time.Second):
		t.Fatalf("streamProcess did not exit after kill")
	}
}

func TestClearInvocationSessionIf_PreservesReboundSession(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	oldSess := server.NewSession()
	newSess := server.NewSession()
	r.registerInvocation("inv-rebind", oldSess, "batch", func() error { return nil })

	// A resumeInvoke rebinds a fresh session…
	r.rebindInvocation("inv-rebind", newSess)
	// …then a stale send failure from the old session must not detach it.
	r.clearInvocationSessionIf("inv-rebind", oldSess)

	if got := r.currentInvocationSession("inv-rebind"); got != newSess {
		t.Fatalf("session = %v, want rebound session preserved", got)
	}
}

func TestClearInvocationSessionIf_ClearsMatchingSession(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	sess := server.NewSession()
	r.registerInvocation("inv-clear", sess, "batch", func() error { return nil })

	r.clearInvocationSessionIf("inv-clear", sess)

	if got := r.currentInvocationSession("inv-clear"); got != nil {
		t.Fatalf("session = %v, want nil", got)
	}
}
