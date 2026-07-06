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
	"time"

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
		go r.runChat(absPath, p.Tool, p.Args, p.SessionMeta)
		return proto.ChatStartResult{Accepted: true}, nil
	}
}

func (r *ChatStarter) runChat(absPath, tool string, args []string, meta *proto.AiSessionMeta) {
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

	// Phase 3 — lock again, merge frontmatter, write assistant response, unlock.
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
	updatedContent := replaceAssistantContent(currentContent, response, meta)
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

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

// frontmatterMeta mirrors proto.AiSessionMeta with an added Updated timestamp.
type frontmatterMeta struct {
	Session string `json:"session"`
	Agent   string `json:"agent"`
	Model   string `json:"model"`
	Updated string `json:"updated"`
}

// hasFrontmatter reports whether text starts with YAML frontmatter (---).
func hasFrontmatter(text string) bool {
	return strings.HasPrefix(text, "---\n") || strings.HasPrefix(text, "---\r\n")
}

// parseFrontmatter extracts the frontmatter block (with delimiters), the body
// after the frontmatter, and a key-value map of parsed fields.
// When no frontmatter is present, block is empty and body is the full text.
func parseFrontmatter(text string) (block, body string, meta map[string]string) {
	meta = make(map[string]string)
	if !hasFrontmatter(text) {
		return "", text, meta
	}
	// Find end of first line (---\n)
	nlLen := 1
	rest := text[4:] // skip "---\n"
	if strings.HasPrefix(text, "---\r\n") {
		rest = text[5:] // skip "---\r\n"
		nlLen = 2
	}
	endIdx := strings.Index(rest, "\n---")
	if endIdx < 0 {
		return "", text, meta
	}
	// block includes everything from "---\n" to "\n---\n"
	blockEnd := endIdx + 5 + nlLen - 1 // +len("\n---\n") adjusted for \r\n
	if nlLen == 2 {
		blockEnd = endIdx + 6 - 1
	}
	block = text[:blockEnd]
	body = text[blockEnd:]

	fmLines := rest[:endIdx]
	for _, raw := range strings.Split(fmLines, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		sep := strings.IndexByte(line, ':')
		if sep < 0 {
			continue
		}
		key := strings.TrimSpace(line[:sep])
		val := strings.TrimSpace(line[sep+1:])
		val = strings.Trim(val, `"'`)
		if val != "" {
			meta[key] = val
		}
	}
	return
}

// renderFrontmatter builds a frontmatter block from a key-value map.
func renderFrontmatter(meta map[string]string) string {
	// Define display order for known keys
	order := []string{"ai_session", "ai_agent", "ai_model", "ai_updated"}
	inOrder := make(map[string]bool)
	for _, k := range order {
		inOrder[k] = true
	}

	var b strings.Builder
	b.WriteString("---\n")
	for _, k := range order {
		if v, ok := meta[k]; ok && v != "" {
			writeFmValue(&b, k, v)
		}
	}
	// Any remaining keys not in the predefined order
	for k, v := range meta {
		if !inOrder[k] && v != "" {
			writeFmValue(&b, k, v)
		}
	}
	b.WriteString("---")
	return b.String()
}

func writeFmValue(b *strings.Builder, key, val string) {
	if strings.ContainsAny(val, ":\n\"'") {
		escaped := strings.ReplaceAll(val, `"`, `\"`)
		b.WriteString(fmt.Sprintf("%s: \"%s\"\n", key, escaped))
	} else {
		b.WriteString(fmt.Sprintf("%s: %s\n", key, val))
	}
}

// mergeFrontmatter updates or inserts frontmatter fields in text.
// Fields in meta that are empty strings are removed.
func mergeFrontmatter(text string, meta map[string]string) string {
	_, body, existing := parseFrontmatter(text)
	merged := make(map[string]string)
	for k, v := range existing {
		merged[k] = v
	}
	for k, v := range meta {
		if v == "" {
			delete(merged, k)
		} else {
			merged[k] = v
		}
	}
	return renderFrontmatter(merged) + body
}

// ─── Chat content helpers ────────────────────────────────────────────────────

// extractLastUserSection finds the last ## User heading and returns the text
// between it and the next section heading (## Assistant or ## User).
// Frontmatter (everything before the first heading) is skipped automatically.
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

func replaceAssistantContent(content, response string, meta *proto.AiSessionMeta) string {
	// Build frontmatter updates
	updates := make(map[string]string)
	if meta != nil {
		if meta.Session != "" {
			updates["ai_session"] = meta.Session
		}
		if meta.Agent != "" {
			updates["ai_agent"] = meta.Agent
		}
		if meta.Model != "" {
			updates["ai_model"] = meta.Model
		}
	}
	updates["ai_updated"] = time.Now().UTC().Format(time.RFC3339)

	if hasFrontmatter(content) {
		_, _, existing := parseFrontmatter(content)
		for k, v := range existing {
			if _, set := updates[k]; !set {
				updates[k] = v
			}
		}
	}

	_, body, _ := parseFrontmatter(content)
	lines := strings.Split(body, "\n")
	headingRe := regexp.MustCompile(`(?i)^##\s+(User|Assistant)\s*$`)

	lastAsstIdx := -1
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "Assistant") {
			lastAsstIdx = i
		}
	}

	if lastAsstIdx >= 0 {
		prefix := strings.Join(lines[:lastAsstIdx], "\n")
		body = prefix + "\n## Assistant\n\n" + response + "\n\n## User\n\n"
	} else {
		trimmed := strings.TrimRight(body, "\n")
		body = trimmed + "\n\n## Assistant\n\n" + response + "\n\n## User\n\n"
	}

	return mergeFrontmatter(body, updates)
}

func writeErrorToFile(absPath, errMsg string) {
	f, err := os.OpenFile(absPath, os.O_RDWR, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
	defer func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }()

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(f); err != nil {
		return
	}
	currentContent := buf.String()

	_, body, meta := parseFrontmatter(currentContent)
	meta["ai_updated"] = time.Now().UTC().Format(time.RFC3339)

	lines := strings.Split(body, "\n")
	headingRe := regexp.MustCompile(`(?i)^##\s+(User|Assistant)\s*$`)
	lastAsstIdx := -1
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "Assistant") {
			lastAsstIdx = i
		}
	}

	errorBlock := fmt.Sprintf("## Assistant\n\n> Error: %s\n\n## User\n\n", errMsg)
	if lastAsstIdx >= 0 {
		body = strings.Join(lines[:lastAsstIdx], "\n") + "\n" + errorBlock
	} else {
		body = strings.TrimRight(body, "\n") + "\n\n" + errorBlock
	}

	finalContent := mergeFrontmatter(body, meta)
	if err := f.Truncate(0); err != nil {
		return
	}
	if _, err := f.Seek(0, 0); err != nil {
		return
	}
	_, _ = f.WriteString(finalContent)
	_ = f.Sync()
}
