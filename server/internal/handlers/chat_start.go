package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

// ChatStarter handles server-side AI chat file processing.
// The daemon reads the chat markdown file, runs the LLM tool, and writes
// the response directly — no streaming back to the plugin.
type ChatStarter struct {
	vaultRoot string
}

// NewChatStarter creates a handler that processes chat files on the server.
func NewChatStarter(vaultRoot string) *ChatStarter {
	return &ChatStarter{vaultRoot: vaultRoot}
}

// Start returns an RPC handler for "chat.start". It accepts params,
// spawns the actual processing in a goroutine, and returns immediately.
func (r *ChatStarter) Start() rpc.Handler {
	return func(ctx context.Context, raw json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.ChatStartParams
		if e := decodeParams("chat.start", raw, &p); e != nil {
			return nil, e
		}
		absPath, rpcErr := resolveOrErr(r.vaultRoot, p.FilePath)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if strings.TrimSpace(p.Tool) == "" {
			return nil, rpc.ErrInvalidParams("chat.start: tool is required")
		}
		go r.runChat(absPath, p.Tool, p.Args)
		return proto.ChatStartResult{Accepted: true}, nil
	}
}

func (r *ChatStarter) runChat(absPath, tool string, args []string) {
	// Phase 1 — lock, read prompt, unlock (lock is released during LLM execution).
	prompt, err := func() (string, error) {
		f, err := os.Open(absPath)
		if err != nil {
			return "", fmt.Errorf("open: %w", err)
		}
		defer f.Close()
		if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
			return "", fmt.Errorf("flock: %w", err)
		}
		defer func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }()

		var buf bytes.Buffer
		if _, err := buf.ReadFrom(f); err != nil {
			return "", fmt.Errorf("read: %w", err)
		}
		prompt := extractLastUserSection(buf.String())
		if prompt == "" {
			return "", fmt.Errorf("no ## User section found")
		}
		return prompt, nil
	}()
	if err != nil {
		writeErrorToFile(absPath, err.Error())
		return
	}

	// Phase 2 — run the LLM tool (no lock, may take minutes).
	// The prompt is passed as the last command-line arg (mirrors how
	// extension.invoke builds the command line from capabilities.json args).
	fullArgs := append(args, prompt)
	cmd := exec.Command(tool, fullArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	response := ""
	if runErr := cmd.Run(); runErr != nil {
		response = fmt.Sprintf("Error: %v\n%s", runErr, strings.TrimSpace(stderr.String()))
	} else {
		response = strings.TrimSpace(stdout.String())
	}

	// Phase 3 — lock again, write assistant response, unlock.
	f, err := os.OpenFile(absPath, os.O_RDWR, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return
	}
	defer func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }()

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(f); err != nil {
		return
	}
	currentContent := buf.String()
	updatedContent := replaceAssistantContent(currentContent, response)
	if updatedContent == currentContent {
		return
	}
	if err := f.Truncate(0); err != nil {
		return
	}
	if _, err := f.Seek(0, 0); err != nil {
		return
	}
	if _, err := f.WriteString(updatedContent); err != nil {
		return
	}
	_ = f.Sync()
}

// extractLastUserSection finds the last ## User heading and returns the text
// between it and the next section heading (## Assistant or ## User).
func extractLastUserSection(content string) string {
	headingRe := regexp.MustCompile(`(?im)^##\s+(User|Assistant)\s*$`)
	lines := strings.Split(content, "\n")

	lastUserIdx := -1
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "User") {
			lastUserIdx = i
		}
	}
	if lastUserIdx == -1 {
		return ""
	}

	nextSection := len(lines)
	for i := lastUserIdx + 1; i < len(lines); i++ {
		if headingRe.MatchString(lines[i]) {
			nextSection = i
			break
		}
	}

	promptLines := lines[lastUserIdx+1 : nextSection]
	return strings.TrimSpace(strings.Join(promptLines, "\n"))
}

// replaceAssistantContent rewrites the ## Assistant section with `response`
// and ensures a ## User section follows. It preserves everything before
// ## Assistant and after the subsequent ## User.
func replaceAssistantContent(content, response string) string {
	asstRe := regexp.MustCompile(`(?im)^##\s+Assistant\s*$`)
	userRe := regexp.MustCompile(`(?im)^##\s+User\s*$`)
	lines := strings.Split(content, "\n")

	asstIdx := -1
	for i, line := range lines {
		if asstRe.MatchString(line) {
			asstIdx = i
			break
		}
	}

	var newLines []string

	if asstIdx == -1 {
		// No ## Assistant heading — insert before EOF.
		newLines = append(newLines, strings.TrimRight(content, "\n"))
		newLines = append(newLines, "", "## Assistant", "", response, "")
	} else {
		// Find ## User heading after ## Assistant.
		nextUser := len(lines)
		for i := asstIdx + 1; i < len(lines); i++ {
			if userRe.MatchString(lines[i]) {
				nextUser = i
				break
			}
		}
		// Lines before ## Assistant (keep verbatim).
		newLines = append(newLines, lines[:asstIdx]...)
		// New assistant block.
		newLines = append(newLines, "", "## Assistant", "", response, "")
		// Lines from ## User onward (preserve User section).
		if nextUser < len(lines) {
			after := lines[nextUser:]
			// Strip leading blank line from after if present.
			if len(after) > 0 && strings.TrimSpace(after[0]) == "" {
				after = after[1:]
			}
			newLines = append(newLines, after...)
		}
	}

	// Ensure a ## User section exists at the end.
	joined := strings.Join(newLines, "\n")
	trimmed := strings.TrimRight(joined, "\n")
	if !userRe.MatchString(joined) {
		trimmed += "\n\n## User\n\n"
	} else if !strings.HasSuffix(trimmed, "\n") {
		trimmed += "\n"
	}
	return trimmed
}

// writeErrorToFile appends an error message as assistant content.
func writeErrorToFile(absPath, errMsg string) {
	f, err := os.OpenFile(absPath, os.O_RDWR|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
	defer func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }()
	_, _ = f.WriteString(fmt.Sprintf("\n## Assistant\n\n> Error: %s\n\n## User\n\n", errMsg))
	_ = f.Sync()
}
