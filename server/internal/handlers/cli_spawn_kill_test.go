package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

type cliPush struct {
	method string
	params interface{}
}

func TestCliSpawn_StreamAndDone(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	sess := server.NewSession()
	pushes := make(chan cliPush, 32)
	sess.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		pushes <- cliPush{method: method, params: params}
		return nil
	})
	ctx := server.WithSession(context.Background(), sess)

	id := "spawn-stream-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	h := CliSpawn(t.TempDir())
	raw, _ := json.Marshal(proto.CliSpawnParams{
		ID:   id,
		Cmd:  os.Args[0],
		Args: []string{"-test.run=TestCliSpawnHelperProcess", "--", "stream"},
		Env:  map[string]string{"GO_WANT_SPAWN_HELPER": "1"},
	})

	result, rerr := h(ctx, raw)
	if rerr != nil {
		t.Fatalf("unexpected rpc error: %+v", rerr)
	}
	if !result.(proto.CliSpawnResult).OK {
		t.Fatal("cli.spawn result ok should be true")
	}

	haveOutput := false
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-pushes:
			switch ev.method {
			case "cli.output":
				p := ev.params.(proto.CliOutputParams)
				if p.ID != id {
					t.Fatalf("cli.output id = %q, want %q", p.ID, id)
				}
				haveOutput = true
			case "cli.done":
				p := ev.params.(proto.CliDoneParams)
				if p.ID != id {
					t.Fatalf("cli.done id = %q, want %q", p.ID, id)
				}
				if p.ExitCode != 0 {
					t.Fatalf("cli.done exitCode = %d, want 0", p.ExitCode)
				}
				if !haveOutput {
					t.Fatal("expected at least one cli.output before cli.done")
				}
				return
			}
		case <-deadline:
			t.Fatal("timeout waiting for cli.done")
		}
	}
}

func TestCliKill_UnknownID(t *testing.T) {
	h := CliKill()
	raw, _ := json.Marshal(proto.CliKillParams{ID: "unknown-" + strconv.FormatInt(time.Now().UnixNano(), 10)})
	_, rerr := h(context.Background(), raw)
	if rerr == nil || rerr.Code != proto.ErrorInvalidParams {
		t.Fatalf("want InvalidParams, got %+v", rerr)
	}
}

func TestCliKill_RunningProcess(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	sess := server.NewSession()
	pushes := make(chan cliPush, 64)
	sess.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		pushes <- cliPush{method: method, params: params}
		return nil
	})
	ctx := server.WithSession(context.Background(), sess)

	id := "spawn-kill-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	spawn := CliSpawn(t.TempDir())
	spawnRaw, _ := json.Marshal(proto.CliSpawnParams{
		ID:   id,
		Cmd:  os.Args[0],
		Args: []string{"-test.run=TestCliSpawnHelperProcess", "--", "sleep"},
		Env:  map[string]string{"GO_WANT_SPAWN_HELPER": "1"},
	})
	if _, rerr := spawn(ctx, spawnRaw); rerr != nil {
		t.Fatalf("spawn failed: %+v", rerr)
	}

	time.Sleep(120 * time.Millisecond)
	kill := CliKill()
	killRaw, _ := json.Marshal(proto.CliKillParams{ID: id})
	if _, rerr := kill(ctx, killRaw); rerr != nil {
		t.Fatalf("kill failed: %+v", rerr)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-pushes:
			if ev.method != "cli.done" {
				continue
			}
			p := ev.params.(proto.CliDoneParams)
			if p.ID != id {
				continue
			}
			return
		case <-deadline:
			t.Fatal("timeout waiting for cli.done after kill")
		}
	}
}

func TestCliSpawn_ResumeUnknownID(t *testing.T) {
	h := CliSpawn(t.TempDir())
	sess := server.NewSession()
	ctx := server.WithSession(context.Background(), sess)
	from := 0
	raw, _ := json.Marshal(proto.CliSpawnParams{
		ID:         "unknown-" + strconv.FormatInt(time.Now().UnixNano(), 10),
		ResumeFrom: &from,
	})

	_, rerr := h(ctx, raw)
	if rerr == nil || rerr.Code != proto.ErrorInvalidParams {
		t.Fatalf("want InvalidParams for unknown resume id, got %+v", rerr)
	}
}

func TestCliSpawn_EmitsBatchNotification(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	sess := server.NewSession()
	pushes := make(chan cliPush, 64)
	sess.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		pushes <- cliPush{method: method, params: params}
		return nil
	})
	ctx := server.WithSession(context.Background(), sess)

	id := "spawn-batch-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	h := CliSpawn(t.TempDir())
	raw, _ := json.Marshal(proto.CliSpawnParams{
		ID:      id,
		Cmd:     os.Args[0],
		Args:    []string{"-test.run=TestCliSpawnHelperProcess", "--", "stream"},
		Env:     map[string]string{"GO_WANT_SPAWN_HELPER": "1"},
		Persist: true,
	})

	if _, rerr := h(ctx, raw); rerr != nil {
		t.Fatalf("unexpected rpc error: %+v", rerr)
	}

	haveBatch := false
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-pushes:
			switch ev.method {
			case "cli.output.batch":
				p := ev.params.(proto.CliOutputBatchParams)
				if len(p.Chunks) > 0 {
					haveBatch = true
				}
			case "cli.done":
				if !haveBatch {
					t.Fatal("expected at least one cli.output.batch before cli.done")
				}
				return
			}
		case <-deadline:
			t.Fatal("timeout waiting for cli.done")
		}
	}
}

func TestCliSpawn_ResumeFromZeroReplaysPersistedOutput(t *testing.T) {
	old := cliWhitelist
	cliWhitelist = map[string]bool{os.Args[0]: true}
	t.Cleanup(func() { cliWhitelist = old })

	id := "spawn-resume-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	h := CliSpawn(t.TempDir())

	sess1 := server.NewSession()
	pushes1 := make(chan cliPush, 64)
	sess1.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		pushes1 <- cliPush{method: method, params: params}
		return nil
	})
	ctx1 := server.WithSession(context.Background(), sess1)

	spawnRaw, _ := json.Marshal(proto.CliSpawnParams{
		ID:      id,
		Cmd:     os.Args[0],
		Args:    []string{"-test.run=TestCliSpawnHelperProcess", "--", "sleep"},
		Env:     map[string]string{"GO_WANT_SPAWN_HELPER": "1"},
		Persist: true,
	})
	if _, rerr := h(ctx1, spawnRaw); rerr != nil {
		t.Fatalf("spawn failed: %+v", rerr)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-pushes1:
			if ev.method == "cli.output" {
				goto resume
			}
		case <-deadline:
			t.Fatal("timeout waiting for first cli.output")
		}
	}

resume:
	sess2 := server.NewSession()
	pushes2 := make(chan cliPush, 64)
	sess2.SetNotifier(func(method string, params interface{}, _ *proto.Meta) error {
		pushes2 <- cliPush{method: method, params: params}
		return nil
	})
	ctx2 := server.WithSession(context.Background(), sess2)
	from := 0
	resumeRaw, _ := json.Marshal(proto.CliSpawnParams{ID: id, ResumeFrom: &from})
	if _, rerr := h(ctx2, resumeRaw); rerr != nil {
		t.Fatalf("resume failed: %+v", rerr)
	}

	haveReplay := false
	resumeDeadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-pushes2:
			if ev.method != "cli.output.batch" {
				continue
			}
			batch := ev.params.(proto.CliOutputBatchParams)
			for _, chunk := range batch.Chunks {
				if chunk.ID == id && chunk.Seq == 0 {
					haveReplay = true
					break
				}
			}
			if haveReplay {
				goto kill
			}
		case <-resumeDeadline:
			t.Fatal("timeout waiting for replayed cli.output.batch")
		}
	}

kill:
	kill := CliKill()
	killRaw, _ := json.Marshal(proto.CliKillParams{ID: id})
	if _, rerr := kill(ctx1, killRaw); rerr != nil {
		t.Fatalf("kill failed: %+v", rerr)
	}
}

func TestCliSpawnHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_SPAWN_HELPER") != "1" {
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
	case "stream":
		fmt.Fprintln(os.Stdout, "out-1")
		fmt.Fprintln(os.Stderr, "err-1")
		time.Sleep(40 * time.Millisecond)
		fmt.Fprintln(os.Stdout, "out-2")
		os.Exit(0)
	case "sleep":
		fmt.Fprintln(os.Stdout, "started")
		time.Sleep(10 * time.Second)
		os.Exit(0)
	default:
		os.Exit(3)
	}
}
