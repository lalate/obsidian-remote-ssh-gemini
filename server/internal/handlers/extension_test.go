package handlers

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

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

func TestExtensionKill_OtherSessionCannotKill(t *testing.T) {
	r := NewExtensionRunner(nil, nil, "")
	owner := server.NewSession()
	called := false
	r.registerInvocation("inv-1", owner, "batch", func() error {
		called = true
		return nil
	})

	h := r.Kill()
	otherCtx := server.WithSession(context.Background(), server.NewSession())
	res, rpcErr := h(otherCtx, json.RawMessage(`{"invocationId":"inv-1"}`))
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
	if called {
		t.Fatalf("stop should not be called for non-owner session")
	}
}

func TestExtensionKill_OwnerCanKill(t *testing.T) {
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

func TestExtensionInvoke_ResumeFromReplay(t *testing.T) {
	tmp := t.TempDir()
	store, err := extensions.NewLogStore(filepath.Join(tmp, "state"))
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}
	ok, err := store.AppendBatch("inv-resume", []proto.CliOutputBatchItem{
		{Stream: "stdout", Data: "a\n", Seq: 1},
		{Stream: "stdout", Data: "b\n", Seq: 2},
	})
	if err != nil || !ok {
		t.Fatalf("AppendBatch: ok=%v err=%v", ok, err)
	}

	r := NewExtensionRunner(nil, store, "")
	owner := server.NewSession()
	r.registerInvocation("inv-resume", owner, "batch", func() error { return nil })

	receiver := server.NewSession()
	notified := false
	receiver.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		if method != "cli.output.batch" {
			return nil
		}
		batch, ok := params.(proto.CliOutputBatchParams)
		if !ok {
			t.Fatalf("unexpected params type: %T", params)
		}
		if len(batch.Items) != 1 || batch.Items[0].Seq != 2 {
			t.Fatalf("unexpected replay payload: %+v", batch)
		}
		notified = true
		return nil
	})

	h := r.Invoke()
	ctx := server.WithSession(context.Background(), receiver)
	res, rpcErr := h(ctx, json.RawMessage(`{"invocationId":"inv-resume","resumeFrom":1}`))
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	out, ok := res.(proto.ExtensionInvokeResult)
	if !ok {
		t.Fatalf("unexpected result type: %T", res)
	}
	if out.InvocationID != "inv-resume" || !out.Accepted {
		t.Fatalf("unexpected result: %+v", out)
	}
	if !notified {
		t.Fatalf("expected replay notification")
	}
}
