package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/extensions"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/llm"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

// ChatStarter handles server-side AI chat file processing.
// The daemon reads the chat markdown file, runs the LLM tool (via the
// provider registry), and writes the response directly — no streaming
// back to the plugin.
type ChatStarter struct {
	vaultRoot string
	registry  *llm.ProviderRegistry
	mu        sync.Mutex
	activeCmd *exec.Cmd
	cancelFn  context.CancelFunc

	// JSONL logging
	logMu   *sync.Mutex
	logPath string
}

// NewChatStarter creates a handler that processes chat files on the server.
func NewChatStarter(vaultRoot string, registry *llm.ProviderRegistry) *ChatStarter {
	return &ChatStarter{
		vaultRoot:  vaultRoot,
		registry:   registry,
		logMu:      &sync.Mutex{},
		logPath:    filepath.Join(vaultRoot, ".obsidian-remote", "chat.log"),
	}
}

func (r *ChatStarter) logChatRequest(absPath, tool string, args []string, sessionID, prompt string) {
	r.logMu.Lock()
	defer r.logMu.Unlock()

	entry := map[string]interface{}{
		"type":        "request",
		"time":        time.Now().UTC().Format(time.RFC3339),
		"file":        absPath,
		"tool":        tool,
		"args":        args,
		"session_id":  sessionID,
		"prompt":      prompt,
	}
	r.writeLogEntry(entry)
}

func (r *ChatStarter) logChatResponse(absPath string, sessionID, response string, err error) {
	r.logMu.Lock()
	defer r.logMu.Unlock()

	entry := map[string]interface{}{
		"type":       "response",
		"time":       time.Now().UTC().Format(time.RFC3339),
		"file":       absPath,
		"session_id": sessionID,
		"response":   response,
	}
	if err != nil {
		entry["error"] = err.Error()
	}
	r.writeLogEntry(entry)
}

func (r *ChatStarter) writeLogEntry(entry map[string]interface{}) {
	// Ensure log directory exists.
	if err := os.MkdirAll(filepath.Dir(r.logPath), 0755); err != nil {
		return
	}

	// Read existing entries (keep last 50).
	var entries []map[string]interface{}
	if data, err := os.ReadFile(r.logPath); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if line == "" {
				continue
			}
			var e map[string]interface{}
			if json.Unmarshal([]byte(line), &e) == nil {
				entries = append(entries, e)
			}
		}
	}

	entries = append(entries, entry)
	if len(entries) > 50 {
		entries = entries[len(entries)-50:]
	}

	// Write back.
	f, err := os.OpenFile(r.logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	for _, e := range entries {
		_ = enc.Encode(e)
	}
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

// Cancel returns an RPC handler for "chat.cancel". It stops the currently
// running chat by cancelling the context (preferred, for provider-based
// execution) or killing the fallback process directly.
func (r *ChatStarter) Cancel() rpc.Handler {
	return func(_ context.Context, raw json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.ChatCancelParams
		if e := decodeParams("chat.cancel", raw, &p); e != nil {
			return nil, e
		}
		// Try context cancellation first.
		r.mu.Lock()
		if r.cancelFn != nil {
			r.cancelFn()
			r.cancelFn = nil
		}
		cmd := r.activeCmd
		r.mu.Unlock()

		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
			return proto.ChatCancelResult{Killed: true}, nil
		}
		// If no activeCmd but cancelFn was called, we still report killed.
		return proto.ChatCancelResult{Killed: true}, nil
	}
}

func (r *ChatStarter) runChat(absPath, tool string, args []string, meta *proto.AiSessionMeta) {
	// Look up provider first to get session field name.
	provider := r.registry.Get(tool)
	sessionFieldName := ""
	if provider != nil {
		sessionFieldName = provider.SessionFieldName()
	}

	// Phase 1 — lock, read file, extract prompt + existing provider session ID, unlock.
	var existingSessionID string
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
		content := buf.String()
		_, _, fm := parseFrontmatter(content)
		if sessionFieldName != "" {
			if s, ok := fm[sessionFieldName]; ok && s != "" {
				existingSessionID = s
			}
		}
		var prompt string
		if existingSessionID != "" {
			prompt = extractLastUserSection(content)
		} else {
			prompt = buildConversationPrompt(content)
		}
		if prompt == "" {
			return "", fmt.Errorf("no ## User section found")
		}
		return prompt, nil
	}()
	if err != nil {
		writeErrorToFile(absPath, err.Error())
		return
	}

	// Log request.
	sessionID := ""
	if meta != nil {
		sessionID = meta.Session
	}
	r.logChatRequest(absPath, tool, args, sessionID, prompt)

	// Phase 2 — run the LLM tool.
	response := ""
	var newSessionID string
	if provider != nil {
		// Use the registered provider (opencode, ollama, etc.).
		ctx, cancel := context.WithCancel(context.Background())
		r.mu.Lock()
		r.cancelFn = cancel
		r.mu.Unlock()

		// Accumulated text from streaming chunks.
		var accumulated string
		var streamSessionID string

		resp, execErr := provider.ExecuteStream(ctx, prompt, args, existingSessionID,
			func(chunk, sid string, done bool) {
				if sid != "" {
					streamSessionID = sid
				}
				if chunk != "" {
					accumulated += chunk
					// Write incremental update to the chat file.
					// The plugin's 1.5s polling picks up these changes in real time.
					r.writeStreamingChunk(absPath, accumulated)
				}
			})

		r.mu.Lock()
		r.cancelFn = nil
		r.activeCmd = nil
		r.mu.Unlock()

		var execErrPtr error
		if execErr != nil {
			response = fmt.Sprintf("Error: %v", execErr)
			execErrPtr = execErr
		} else if resp != nil && resp.Error != "" {
			response = fmt.Sprintf("Error: %s", resp.Error)
			execErrPtr = fmt.Errorf("%s", resp.Error)
		} else if resp != nil {
			response = resp.Text
		}
		if resp != nil {
			newSessionID = resp.SessionID
		}
		if streamSessionID != "" && newSessionID == "" {
			newSessionID = streamSessionID
		}

		r.logChatResponse(absPath, newSessionID, response, execErrPtr)
	} else {
		// Fallback: raw exec.Command for unknown / custom tools.
		fullArgs := append(args, prompt)
		cmd := exec.Command(tool, fullArgs...)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		r.mu.Lock()
		r.activeCmd = cmd
		r.mu.Unlock()

		var runErrPtr error
		if runErr := cmd.Run(); runErr != nil {
			response = fmt.Sprintf("Error: %v\n%s", runErr, strings.TrimSpace(stderr.String()))
			runErrPtr = runErr
		} else {
			response = strings.TrimSpace(stdout.String())
		}

		r.mu.Lock()
		r.activeCmd = nil
		r.mu.Unlock()

		r.logChatResponse(absPath, "", response, runErrPtr)
	}

	// Phase 3 — lock again, merge frontmatter, write final assistant response, unlock.
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
	if newSessionID != "" && sessionFieldName != "" {
		updates[sessionFieldName] = newSessionID
	}
	updates["ai_updated"] = time.Now().UTC().Format(time.RFC3339)

	updatedContent := replaceAssistantContent(currentContent, response, updates)
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

// writeStreamingChunk updates the assistant section of the chat file with the
// accumulated streaming text. Locks the file, reads current content, updates
// the assistant section in place (without adding ## User), and writes back.
func (r *ChatStarter) writeStreamingChunk(absPath, accumulated string) {
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

	newContent := updateAssistantContent(currentContent, accumulated)
	if newContent == currentContent {
		return
	}
	if err := f.Truncate(0); err != nil {
		return
	}
	if _, err := f.Seek(0, 0); err != nil {
		return
	}
	if _, err := f.WriteString(newContent); err != nil {
		return
	}
	_ = f.Sync()
}

// updateAssistantContent replaces the content between the last ## Assistant
// heading and the next section heading with accumulated, without modifying
// frontmatter or adding ## User. Used during streaming to incrementally
// update the assistant response.
func updateAssistantContent(content, accumulated string) string {
	_, body, meta := parseFrontmatter(content)
	lines := strings.Split(body, "\n")
	headingRe := regexp.MustCompile(`(?i)^##\s+(User|Assistant)\s*$`)

	lastAsstIdx := -1
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "Assistant") {
			lastAsstIdx = i
		}
	}
	if lastAsstIdx < 0 {
		return content
	}

	nextIdx := len(lines)
	for i := lastAsstIdx + 1; i < len(lines); i++ {
		if headingRe.MatchString(lines[i]) {
			nextIdx = i
			break
		}
	}

	prefix := strings.Join(lines[:lastAsstIdx+1], "\n")
	suffix := ""
	if nextIdx < len(lines) {
		suffix = "\n" + strings.Join(lines[nextIdx:], "\n")
	}

	newBody := prefix + "\n\n" + accumulated + "\n" + suffix
	return mergeFrontmatter(newBody, meta)
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
	blockEnd := 4 + endIdx + 4 + nlLen
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
	for k, v := range meta {
		if !inOrder[k] && v != "" {
			writeFmValue(&b, k, v)
		}
	}
	b.WriteString("---\n")
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

// extractLastUserSection finds the last NON-EMPTY ## User heading and returns the text
// between it and the next section heading (## Assistant or ## User).
// This skips trailing empty User sections that are added as placeholders for the next turn.
func extractLastUserSection(content string) string {
	headingRe := regexp.MustCompile(`(?im)^##\s+(User|Assistant)\s*$`)
	lines := strings.Split(content, "\n")

	// Find all User headings, then pick the last one with non-empty content.
	userIndices := []int{}
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "User") {
			userIndices = append(userIndices, i)
		}
	}

	// Iterate backwards to find the last User section with actual content.
	for idx := len(userIndices) - 1; idx >= 0; idx-- {
		lastUserIdx := userIndices[idx]
		nextSection := len(lines)
		for i := lastUserIdx + 1; i < len(lines); i++ {
			if headingRe.MatchString(lines[i]) {
				nextSection = i
				break
			}
		}
		promptLines := lines[lastUserIdx+1 : nextSection]
		prompt := strings.TrimSpace(strings.Join(promptLines, "\n"))
		if prompt != "" {
			return prompt
		}
	}
	return ""
}

// buildConversationPrompt returns the full chat conversation body
// (frontmatter stripped) so the LLM sees the complete history.
func buildConversationPrompt(content string) string {
	body := content
	// Strip YAML frontmatter so the LLM only sees the conversation.
	if hasFrontmatter(content) {
		_, body, _ = parseFrontmatter(content)
	}
	body = strings.TrimSpace(body)
	// Verify there is at least one ## User section.
	headingRe := regexp.MustCompile(`(?im)^##\s+(User|Assistant)\s*$`)
	if !headingRe.MatchString(body) {
		return ""
	}
	return body
}

func replaceAssistantContent(content, response string, updates map[string]string) string {
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

// ─── Status check ─────────────────────────────────────────────────────────────

// ChatStatusHandler returns the health of the LLM toolchain by querying the
// registered providers and merging their status with capability argRules.
type ChatStatusHandler struct {
	mgr      *extensions.Manager
	registry *llm.ProviderRegistry
}

// NewChatStatusHandler creates a handler that reports LLM tool status.
func NewChatStatusHandler(mgr *extensions.Manager, registry *llm.ProviderRegistry) *ChatStatusHandler {
	return &ChatStatusHandler{mgr: mgr, registry: registry}
}

// Status returns an RPC handler for "chat.status".
func (r *ChatStatusHandler) Status() rpc.Handler {
	return func(_ context.Context, _ json.RawMessage) (interface{}, *rpc.Error) {
		var tools []proto.ChatToolStatus
		ctx := context.Background()

		// Collect health from each registered provider.
		providers := r.registry.All()
		for _, p := range providers {
			health := p.Healthy(ctx)
			ts := providerToToolStatus(p, health)

			// Merge argRules from capabilities if available.
			for _, ext := range r.mgr.SchemaResult().Extensions {
				if ext.Tool == p.ToolName() {
					ts.Command = ext.Command // prefer resolved capabilities path
					if len(ext.Args) > 0 {
						ts.ArgRules = make([]proto.ExtensionArgRule, len(ext.Args))
						copy(ts.ArgRules, ext.Args)
					}
					break
				}
			}

			tools = append(tools, ts)
		}

		// If no providers registered, fall back to scanning common tools.
		if len(tools) == 0 {
			tools = r.scanCommonTools()
		}

		defaultTool := ""
		healthy := false
		for _, t := range tools {
			if defaultTool == "" {
				defaultTool = t.Tool
			}
			if t.Available && t.Running {
				healthy = true
			}
		}

		// Discover the opencode serve port from the opencode provider.
		openCodePort := r.discoverOpenCodePort()

		// Fetch model/agent lists from all providers.
		var models []proto.LlmModel
		var agents []proto.LlmAgent
		for _, p := range providers {
			if m, err := p.ListModels(ctx); err == nil {
				models = append(models, m...)
			}
			if a, err := p.ListAgents(ctx); err == nil {
				agents = append(agents, a...)
			}
		}

		return proto.ChatStatusResult{
			Tools:       tools,
			DefaultTool: defaultTool,
			ServerPort:  openCodePort,
			Healthy:     healthy,
			Models:      models,
			Agents:      agents,
		}, nil
	}
}

func providerToToolStatus(p llm.LlmProvider, health llm.LlmHealth) proto.ChatToolStatus {
	ts := proto.ChatToolStatus{
		Tool:      p.ToolName(),
		Command:   p.Command(),
		Available: health.Available,
		Running:   health.Running,
	}
	if health.Error != "" {
		ts.Error = health.Error
	}
	return ts
}

func (r *ChatStatusHandler) discoverOpenCodePort() int {
	// Try the opencode provider first.
	if p := r.registry.Get("opencode"); p != nil {
		health := p.Healthy(context.Background())
		return health.ServerPort
	}
	// Fallback: direct TCP probe on common ports.
	for _, port := range []int{4096, 4097, 4098, 4099} {
		addr := fmt.Sprintf("127.0.0.1:%d", port)
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err != nil {
			continue
		}
		conn.Close()
		return port
	}
	return 0
}

// scanCommonTools is the fallback when no providers are registered.
func (r *ChatStatusHandler) scanCommonTools() []proto.ChatToolStatus {
	var tools []proto.ChatToolStatus

	for _, candidate := range []struct {
		name    string
		binName string
	}{
		{"opencode", "opencode"},
		{"ollama", "ollama"},
	} {
		path, err := exec.LookPath(candidate.binName)
		if err != nil {
			tools = append(tools, proto.ChatToolStatus{
				Tool:      candidate.name,
				Available: false,
				Running:   false,
				Error:     "not found in PATH",
			})
			continue
		}

		ts := proto.ChatToolStatus{
			Tool:      candidate.name,
			Command:   path,
			Available: true,
		}

		if candidate.name == "opencode" {
			if ok, _ := openCodeServeRunning(); ok {
				ts.Running = true
			} else {
				ts.Error = "opencode serve not running"
			}
		} else if candidate.name == "ollama" {
			if ok, _ := ollamaRunning(); ok {
				ts.Running = true
			} else {
				ts.Error = "ollama server not running (try: ollama serve)"
			}
		}

		tools = append(tools, ts)
	}

	return tools
}

// openCodeServeRunning checks if the opencode serve health endpoint responds.
func openCodeServeRunning() (bool, error) {
	for _, port := range []int{4096, 4097, 4098, 4099} {
		url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
		client := &http.Client{Timeout: 500 * time.Millisecond}
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return true, nil
		}
	}
	return false, nil
}

// ollamaRunning checks if the Ollama API responds.
func ollamaRunning() (bool, error) {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:11434/api/tags")
	if err != nil {
		return false, err
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK, nil
}
