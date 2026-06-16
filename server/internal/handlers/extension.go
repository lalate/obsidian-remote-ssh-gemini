package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/extensions"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

type extensionRunner struct {
	mgr      *extensions.Manager
	logs     *extensions.LogStore
	vaultDir string
	seq      atomic.Int64
	slots    chan struct{}
}

const maxConcurrentExtensionInvocations = 4

func NewExtensionRunner(mgr *extensions.Manager, logs *extensions.LogStore, vaultDir string) *extensionRunner {
	return &extensionRunner{
		mgr:      mgr,
		logs:     logs,
		vaultDir: vaultDir,
		slots:    make(chan struct{}, maxConcurrentExtensionInvocations),
	}
}

func (r *extensionRunner) Schema() rpc.Handler {
	return func(_ context.Context, _ json.RawMessage) (interface{}, *rpc.Error) {
		return r.mgr.SchemaResult(), nil
	}
}

func (r *extensionRunner) Invoke() rpc.Handler {
	return func(ctx context.Context, raw json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.ExtensionInvokeParams
		if e := decodeParams("extension.invoke", raw, &p); e != nil {
			return nil, e
		}
		if strings.TrimSpace(p.Tool) == "" {
			return nil, rpc.ErrInvalidParams("extension.invoke: tool is required")
		}
		cap, ok := r.mgr.ResolveTool(p.Tool)
		if !ok {
			return nil, rpc.ErrExtensionDenied(p.Tool)
		}
		if err := r.mgr.VerifyToolBinary(p.Tool); err != nil {
			return nil, rpc.ErrBinaryHashMismatch(p.Tool)
		}

		args, err := validateAndBuildArgs(cap, p.Args)
		if err != nil {
			return nil, rpc.ErrInvalidParams("extension.invoke: " + err.Error())
		}

		select {
		case r.slots <- struct{}{}:
		case <-ctx.Done():
			return nil, rpc.ErrInternal("extension.invoke: context canceled")
		}
		released := false
		releaseSlot := func() {
			if released {
				return
			}
			<-r.slots
			released = true
		}

		cmd := exec.Command(cap.Command, args...) // #nosec G204 - command is pinned by capabilities + startup hash verification

		if p.WorkingDir != "" {
			if !cap.AllowWorkingDir {
				releaseSlot()
				return nil, rpc.ErrInvalidParams("extension.invoke: workingDir is not allowed for this tool")
			}
			wd, werr := validateWorkingDir(r.vaultDir, p.WorkingDir)
			if werr != nil {
				releaseSlot()
				return nil, werr
			}
			cmd.Dir = wd
		}

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			releaseSlot()
			return nil, rpc.ErrInternal("extension.invoke: stdout pipe: " + err.Error())
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			releaseSlot()
			return nil, rpc.ErrInternal("extension.invoke: stderr pipe: " + err.Error())
		}

		if err := cmd.Start(); err != nil {
			releaseSlot()
			return nil, rpc.ErrInternal("extension.invoke: start: " + err.Error())
		}

		session := server.SessionFromContext(ctx)
		invocationID := fmt.Sprintf("inv-%d-%d", time.Now().UnixMilli(), r.seq.Add(1))
		persist := cap.PersistDefault
		if p.Persist != nil {
			persist = *p.Persist
		}
		go r.streamProcess(session, invocationID, cmd, stdout, stderr, persist, cap.OutputMode, releaseSlot)

		return proto.ExtensionInvokeResult{InvocationID: invocationID, Accepted: true}, nil
	}
}

func validateAndBuildArgs(cap proto.ExtensionCapability, provided map[string]string) ([]string, error) {
	if provided == nil {
		provided = map[string]string{}
	}
	known := map[string]struct{}{}
	for _, rule := range cap.Args {
		known[rule.Name] = struct{}{}
		val := provided[rule.Name]
		if strings.HasPrefix(strings.TrimLeft(val, " \t\r\n"), "-") && !rule.AllowFlags {
			return nil, fmt.Errorf("arg %q must not start with '-'; set allowFlags to opt in", rule.Name)
		}
		if rule.Required && strings.TrimSpace(val) == "" {
			return nil, fmt.Errorf("arg %q is required", rule.Name)
		}
		if rule.MaxLength > 0 && len(val) > rule.MaxLength {
			return nil, fmt.Errorf("arg %q exceeds maxLength %d", rule.Name, rule.MaxLength)
		}
		if strings.TrimSpace(rule.Pattern) != "" && val != "" {
			rx, err := regexp.Compile(rule.Pattern)
			if err != nil {
				return nil, fmt.Errorf("arg %q pattern compile failed", rule.Name)
			}
			if !rx.MatchString(val) {
				return nil, fmt.Errorf("arg %q does not match required pattern", rule.Name)
			}
		}
	}
	for name := range provided {
		if _, ok := known[name]; !ok {
			return nil, fmt.Errorf("arg %q is not allowed", name)
		}
	}
	out := make([]string, 0, len(cap.Args))
	for _, rule := range cap.Args {
		if v, ok := provided[rule.Name]; ok && v != "" {
			out = append(out, v)
		}
	}
	return out, nil
}

func (r *extensionRunner) streamProcess(session *server.Session, invocationID string, cmd *exec.Cmd, stdout io.ReadCloser, stderr io.ReadCloser, persist bool, outputMode string, releaseSlot func()) {
	defer releaseSlot()
	itemsCh := make(chan proto.CliOutputBatchItem, 256)
	var wg sync.WaitGroup
	wg.Add(2)
	go r.scanStream(&wg, stdout, "stdout", itemsCh)
	go r.scanStream(&wg, stderr, "stderr", itemsCh)
	go func() {
		wg.Wait()
		close(itemsCh)
	}()

	persistEnabled := persist && r.logs != nil
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	batch := make([]proto.CliOutputBatchItem, 0, 50)
	flush := func() bool {
		if len(batch) == 0 {
			return true
		}
		payload := append([]proto.CliOutputBatchItem(nil), batch...)
		if outputMode == "single" {
			for _, it := range payload {
				if err := session.SendNotification("cli.output", proto.CliOutputParams{
					InvocationID: invocationID,
					Stream:       it.Stream,
					Data:         it.Data,
					Seq:          it.Seq,
				}); err != nil {
					_ = cmd.Process.Kill()
					return false
				}
			}
		} else {
			if err := session.SendNotification("cli.output.batch", proto.CliOutputBatchParams{
				InvocationID: invocationID,
				Items:        payload,
			}); err != nil {
				_ = cmd.Process.Kill()
				return false
			}
		}
		if persistEnabled {
			ok, err := r.logs.AppendBatch(invocationID, payload)
			if err != nil || !ok {
				persistEnabled = false
			}
		}
		batch = batch[:0]
		return true
	}

	for {
		select {
		case it, ok := <-itemsCh:
			if !ok {
				if !flush() {
					_ = cmd.Wait()
					return
				}
				exitCode := 0
				sig := ""
				if err := cmd.Wait(); err != nil {
					if ee, ok := err.(*exec.ExitError); ok {
						exitCode = ee.ExitCode()
					} else {
						exitCode = 1
						sig = err.Error()
					}
				}
				_ = session.SendNotification("cli.done", proto.CliDoneParams{
					InvocationID: invocationID,
					ExitCode:     exitCode,
					Signal:       sig,
				})
				return
			}
			batch = append(batch, it)
			if len(batch) >= 50 {
					if !flush() {
						_ = cmd.Wait()
						return
					}
			}
		case <-ticker.C:
			if !flush() {
				_ = cmd.Wait()
				return
			}
		}
	}
}

func (r *extensionRunner) scanStream(wg *sync.WaitGroup, src io.Reader, stream string, out chan<- proto.CliOutputBatchItem) {
	defer wg.Done()
	scanner := bufio.NewScanner(src)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		seq := r.seq.Add(1)
		out <- proto.CliOutputBatchItem{Stream: stream, Data: scanner.Text() + "\n", Seq: seq}
	}
	if err := scanner.Err(); err != nil {
		seq := r.seq.Add(1)
		out <- proto.CliOutputBatchItem{Stream: "stderr", Data: "[stream error] " + err.Error() + "\n", Seq: seq}
	}
}

